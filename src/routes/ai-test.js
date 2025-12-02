// src/routes/ai-test.js
//
// Kalibracja jadłospisu od AI względem realnych makr z bazy produktów.
// - bierze "variant" (taki jak w asystent-ai.js po normalizeVariant)
// - woła /api/ai/resolve-day-plan żeby dopasować produkty
// - pobiera produkty z /api/products/:id
// - liczy faktyczne makra z bazy
// - jeśli różnice > MACRO_TOLERANCE, przeskalowuje gramatury (do 3 iteracji)
// - zwraca wariant po kalibracji + teksty do wyświetlenia na stronie

const express = require('express');
const router = express.Router();

// ===== KONFIGURACJA =====
const MACRO_TOLERANCE = 0.02;   // 2% dla B/T/W
const KCAL_TOLERANCE  = 0.03;   // np. 3% dla kcal

// ile razy maksymalnie próbujemy skalować
const SCALE_ITERATIONS = 50;

// minimalne pokrycie makro z bazy, żeby w ogóle próbować skalować (np. 0.6 = 60%)
const MIN_MACRO_COVERAGE = 0.6;

// ograniczenia współczynnika skalowania
// >1 dla podbijania (up), <1 dla ścinania (down)
const SCALE_FACTOR_MIN = 0.7;  // przy ścinaniu makro (min ~70%)
const SCALE_FACTOR_MAX = 1.3;  // przy podbijaniu (max ~130%)

// baza URL do wewnętrznych requestów HTTP (na ten sam serwer)
const PORT = process.env.PORT || 4000;
const INTERNAL_BASE_URL =
  process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;

// ===== Helpers ogólne =====

function toNum(v, def = 0) {
  if (v === null || v === undefined) return def;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

function normalizeTotals(raw) {
  if (!raw) return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  return {
    kcal: toNum(raw.kcal ?? raw.calories ?? raw.k, 0),
    protein: toNum(raw.protein ?? raw.p ?? raw.b, 0),
    fat: toNum(raw.fat ?? raw.f ?? raw.t, 0),
    carbs: toNum(raw.carbs ?? raw.c ?? raw.w, 0),
  };
}

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

// makro produktu z bazy, per 100 g – staramy się być odporni na różne nazwy pól
// makro produktu z bazy, per 100 g – staramy się być odporni na różne nazwy pól
function getProductMacrosPer100g(p) {
  if (!p || typeof p !== 'object') {
    return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  }

  const kcal = toNum(
    p.kcal100 ?? p.kcal ?? p.calories ?? p.kcal_100 ?? p.energy_kcal,
    0
  );
  const protein = toNum(
    p.p100 ?? p.protein_g ?? p.protein ?? p.bialko ?? p.protein_100,
    0
  );
  const fat = toNum(
    p.f100 ?? p.fat_g ?? p.fat ?? p.tluszcz ?? p.fat_100,
    0
  );
  const carbs = toNum(
    p.c100 ?? p.carbs_g ?? p.carbs ?? p.weglowodany ?? p.carbs_100,
    0
  );

  return { kcal, protein, fat, carbs };
}


// policz różnice względne względem celu
function computeRelativeDiff(actual, target) {
  const out = {};
  for (const key of ['kcal', 'protein', 'fat', 'carbs']) {
    const a = toNum(actual[key], 0);
    const t = toNum(target[key], 0);
    if (!t || t === 0) {
      out[key] = 0;
    } else {
      out[key] = Math.abs(a - t) / Math.abs(t);
    }
  }
  return out;
}

function needsScaling(relDiff) {
  return (
    relDiff.protein > MACRO_TOLERANCE ||
    relDiff.fat     > MACRO_TOLERANCE ||
    relDiff.carbs   > MACRO_TOLERANCE
    // kcal tylko raportujemy w logach,
    // ale nie wymuszamy na nim 2%.
  );
}




// z makr realnych i targetu wyznaczamy pojedynczy współczynnik skalowania
function computeScaleFactor(actualTotals, targetTotals) {
  const factors = [];

  for (const key of ['kcal', 'protein', 'fat', 'carbs']) {
    const a = toNum(actualTotals[key], 0);
    const t = toNum(targetTotals[key], 0);
    if (a > 0 && t > 0) {
      const ratio = t / a;
      factors.push(ratio);
    }
  }

  if (!factors.length) return 1;

  // prosta średnia – możesz sobie zmienić na medianę, maxa itd.
  let factor =
    factors.reduce((sum, v) => sum + v, 0) / factors.length;

  // delikatne ograniczenie, żeby nie odjechać
  if (factor < 0.5) factor = 0.5;
  if (factor > 1.6) factor = 1.6;

  return factor;
}


// wybieramy makro z największą względną różnicą i liczymy faktor
// tylko dla produktów bogatych w to makro
// wybieramy makro z największą względną różnicą:
// najpierw deficyty (a < t), potem nadwyżki (a > t)
// i liczymy faktor dla produktów bogatych w to makro
function computeMacroScaleStep(meals, actualTotals, targetTotals) {
  const keys = ['protein', 'fat', 'carbs'];

  let mainKey = null;
  let mainRelDiff = 0;
  let mode = null; // 'up' (deficyt) lub 'down' (nadwyżka)

  // 1) Szukamy makra z NAJWIĘKSZĄ bezwzględną różnicą względną
  for (const key of keys) {
    const a = toNum(actualTotals[key], 0);
    const t = toNum(targetTotals[key], 0);
    if (!t) continue;

    const delta = (a - t) / t; // <0 deficyt, >0 nadwyżka
    const rel = Math.abs(delta);

    if (rel > mainRelDiff) {
      mainRelDiff = rel;
      mainKey = key;
      mode = delta < 0 ? 'up' : 'down';
    }
  }

  if (!mainKey || mainRelDiff <= MACRO_TOLERANCE || !mode) {
    return {
      macro: null,
      relDiff: mainRelDiff,
      factor: 1,
      richCount: 0,
      mode: null,
    };
  }

  // 2) Liczymy, ile tego makro jest w produktach "bogatych" i "niebogatych"
  let richMacro = 0;
  let nonRichMacro = 0;
  let richCount = 0;

  for (const meal of meals) {
    for (const item of meal.items || []) {
      const per100 = item.per100;
      const macros = item.macros;
      if (!per100 || !macros) continue;

      const density = toNum(per100[mainKey], 0); // np. g tłuszczu / 100 g
      const val = toNum(macros[mainKey], 0);     // ile g tego makro wnosi item

      // proste odcięcie śladowych ilości
      if (density > 0.5 && val > 0.5) {
        richMacro += val;
        richCount++;
      } else {
        nonRichMacro += val;
      }
    }
  }

  const t = toNum(targetTotals[mainKey], 0);

  if (!t || !richCount || richMacro <= 0) {
    return { macro: mainKey, relDiff: mainRelDiff, factor: 1, richCount, mode };
  }

  // 3) chcemy: nonRich + factor * richMacro ≈ target
  let factor = (t - nonRichMacro) / richMacro;

  if (!Number.isFinite(factor)) {
    return { macro: mainKey, relDiff: mainRelDiff, factor: 1, richCount, mode };
  }

  if (mode === 'up') {
    // przy deficycie nie zmniejszamy – tylko delikatne podbicie
    if (factor < 1) factor = 1;
    if (factor > SCALE_FACTOR_MAX) factor = SCALE_FACTOR_MAX;
  } else if (mode === 'down') {
    // przy nadwyżce nie zwiększamy – tylko ścinamy
    if (factor > 1) factor = 1;
    if (factor < SCALE_FACTOR_MIN) factor = SCALE_FACTOR_MIN;
  }

  return { macro: mainKey, relDiff: mainRelDiff, factor, richCount, mode };
}









// policz makra dla całego wariantu zgodnie z gramaturą i produktami
function computePlanMacros(meals, productById) {
  const dayTotals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const mealsTotals = [];

  for (const meal of meals) {
    const mt = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    for (const item of meal.items || []) {
      const grams = toNum(item.grams, 0);
      const product =
        item.dbProductId && productById.get(item.dbProductId);

      if (!product || !grams) continue;

      const per100 = getProductMacrosPer100g(product);

      const kcal = (per100.kcal * grams) / 100;
      const protein = (per100.protein * grams) / 100;
      const fat = (per100.fat * grams) / 100;
      const carbs = (per100.carbs * grams) / 100;

      item.macros = {
        kcal,
        protein,
        fat,
        carbs,
      };
      item.per100 = per100;

      mt.kcal += kcal;
      mt.protein += protein;
      mt.fat += fat;
      mt.carbs += carbs;

      dayTotals.kcal += kcal;
      dayTotals.protein += protein;
      dayTotals.fat += fat;
      dayTotals.carbs += carbs;
    }
    meal.totals = mt;
    mealsTotals.push(mt);
  }

  return { dayTotals, mealsTotals };
}

// dla UI: "nazwa_z_bazy (nazwa_AI) 100g(80g)"
function buildDisplayMeals(meals) {
  return meals.map((meal) => ({
    slot: meal.slot,
    items: (meal.items || []).map((item) => {
      const gAfter = Math.round(toNum(item.grams, 0));
      const gBefore = Math.round(toNum(item.aiGrams, 0));
      const dbName = item.dbName || item.aiName || 'Produkt';
      const aiName = item.aiName || item.dbName || 'Produkt';
      const label = `${dbName} ${gAfter} g`;

      return {
        label,
        dbName,
        aiName,
        grams: gAfter,
        gramsAi: gBefore,
      };
    }),
  }));
}


router.post('/day-plan/test', async (req, res) => {
  try {
    const rawVariant = req.body?.variant;
    if (!rawVariant || !Array.isArray(rawVariant.meals)) {
      return res.status(400).json({
        ok: false,
        message:
          'Brak poprawnego wariantu jadłospisu w body (pole "variant").',
      });
    }

    // 1) Normalizacja totals jak na froncie
    const variant = cloneDeep(rawVariant);
    variant.totals = normalizeTotals(variant.totals);

    if (
      !(
        variant.totals.kcal ||
        variant.totals.protein ||
        variant.totals.fat ||
        variant.totals.carbs
      )
    ) {
      // jeśli totals puste – sumujemy z deklarowanych totals posiłków (jeżeli są)
      const sum = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
      for (const m of variant.meals || []) {
        const mt = normalizeTotals(m.totals);
        sum.kcal += mt.kcal;
        sum.protein += mt.protein;
        sum.fat += mt.fat;
        sum.carbs += mt.carbs;
      }
      variant.totals = sum;
    }

    const targetTotals = variant.totals || {
      kcal: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
    };

    // console.log('[AI-TEST] Target totals z AI:', targetTotals);

    // 2) resolve-day-plan – używamy istniejącego endpointu do dopasowania produktów
    const resolveResp = await fetch(
      `${INTERNAL_BASE_URL}/api/ai/resolve-day-plan`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // przenosimy Authorization, żeby działały te same uprawnienia
          ...(req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : {}),
        },
        body: JSON.stringify({ variant }),
      }
    );

    if (!resolveResp.ok) {
      let msg = `HTTP ${resolveResp.status} przy resolve-day-plan`;
      try {
        const j = await resolveResp.json();
        if (j?.message) msg = j.message;
      } catch {
        /* ignore */
      }
      console.error('[AI-TEST] Błąd resolve-day-plan:', msg);
      return res
        .status(500)
        .json({ ok: false, message: 'Błąd resolve-day-plan: ' + msg });
    }

    const resolveJson = await resolveResp.json();
    const mapped = Array.isArray(resolveJson?.mapped)
      ? resolveJson.mapped
      : [];

    // 3) mapa: nazwa_AI -> { productId, productName, isAuto }
    const mappingByName = new Map();

    for (const m of mapped) {
      const name = String(m?.name || '').trim();
      if (!name) continue;
      const suggestions = Array.isArray(m.suggestions)
        ? m.suggestions
        : [];
      if (!suggestions.length) continue;

      // najpierw auto-dopasowanie, jak w asystent-ai.js
      let best =
        suggestions.find(
          (s) => s && s.isAuto && s.productId
        ) || suggestions.find((s) => s && s.productId);

      if (!best) continue;

      const entry = {
        productId: String(best.productId),
        productName:
          best.productName || best.name || best.label || name,
        isAuto: !!best.isAuto,
      };
      mappingByName.set(name, entry);

      // log do terminala: co do czego
    //   console.log(
    //     `[AI-TEST] Dopasowanie składnika "${name}" -> produkt "${entry.productName}" (${entry.productId}) auto=${entry.isAuto}`
    //   );
    }

    if (!mappingByName.size) {
      return res.status(200).json({
        ok: true,
        message:
          'Brak dopasowanych produktów – nie można policzyć realnych makr.',
        variantOriginal: variant,
        mapped: [],
      });
    }

    // 4) Pobieramy produkty z istniejącego /api/products/:id
    const uniqueProductIds = Array.from(
      new Set(
        Array.from(mappingByName.values())
          .map((v) => v.productId)
          .filter(Boolean)
      )
    );

    const productById = new Map();

    for (const pid of uniqueProductIds) {
      try {
        const resp = await fetch(
          `${INTERNAL_BASE_URL}/api/products/${encodeURIComponent(
            pid
          )}`,
          {
            headers: {
              'Content-Type': 'application/json',
              ...(req.headers.authorization
                ? { Authorization: req.headers.authorization }
                : {}),
            },
          }
        );

        if (!resp.ok) {
          console.warn(
            `[AI-TEST] Nie udało się pobrać produktu ${pid}: HTTP ${resp.status}`
          );
          continue;
        }

        const j = await resp.json();
        const product = j?.product || j?.data || j;
        if (!product || typeof product !== 'object') continue;

        productById.set(pid, product);

        const per100 = getProductMacrosPer100g(product);
        // console.log(
        //   `[AI-TEST] Produkt ${pid}: "${product.name || 'bez_nazwy'}" per 100g ->`,
        //   per100
        // );
      } catch (e) {
        console.warn(
          `[AI-TEST] Wyjątek przy pobieraniu produktu ${pid}:`,
          e
        );
      }
    }

    if (!productById.size) {
      return res.status(200).json({
        ok: true,
        message:
          'Nie udało się pobrać żadnych produktów – brak kalibracji.',
        variantOriginal: variant,
        mapped,
      });
    }

    // 5) Budujemy strukturę z aiName / dbName / grams / aiGrams
    const calibratedMeals = (variant.meals || []).map((meal) => {
      const slot = (meal.slot || meal.name || 'Posiłek').trim();
      const items = (meal.items || []).map((it) => {
        const aiName = String(it?.name || '').trim();
        const grams = toNum(it?.grams, 0);

        const mapEntry = aiName ? mappingByName.get(aiName) : null;
        const dbProductId = mapEntry?.productId || null;
        const dbName = mapEntry?.productName || aiName;

        return {
          aiName,
          dbName,
          aiGrams: grams,
          grams, // aktualna gramatura (będzie skalowana)
          dbProductId,
        };
      });

      return {
        slot,
        items,
      };
    });

    // 6) Liczymy makra z bazy PRZED skalowaniem
    const before = computePlanMacros(calibratedMeals, productById);
    const totalsBefore = before.dayTotals;
    // console.log('[AI-TEST] Totals z bazy PRZED skalowaniem:', totalsBefore);

    // sprawdź, jaki procent celu pokrywamy z bazy
const coverage = {
  protein: targetTotals.protein
    ? totalsBefore.protein / targetTotals.protein
    : 1,
  fat: targetTotals.fat ? totalsBefore.fat / targetTotals.fat : 1,
  carbs: targetTotals.carbs ? totalsBefore.carbs / targetTotals.carbs : 1,
};

// console.log('[AI-TEST] Coverage before scaling:', coverage);

const maxCoverage = Math.max(
  isFinite(coverage.protein) ? coverage.protein : 0,
  isFinite(coverage.fat) ? coverage.fat : 0,
  isFinite(coverage.carbs) ? coverage.carbs : 0
);

// jeśli pokrycie wszystkich makro jest bardzo słabe – nie skalujemy
if (maxCoverage < MIN_MACRO_COVERAGE) {
  console.log(
    `[AI-TEST] Pokrycie makr < ${MIN_MACRO_COVERAGE *
      100}% – pomijam skalowanie (za mało produktów w bazie).`
  );

  const totalsDbBefore = totalsBefore;
  const totalsDbAfter = totalsBefore;

  const variantCalibrated = {
    title: variant.title || 'Jadłospis dnia',
    description:
      variant.description ||
      'Nie skalibrowano – za mało dopasowanych produktów w bazie, aby przeliczyć makro.',
    totalsTarget: targetTotals,
    totalsDbBefore,
    totalsDbAfter,
    meals: calibratedMeals.map((m) => ({
      slot: m.slot,
      totals: m.totals,
      items: m.items,
    })),
  };

  const displayMeals = buildDisplayMeals(calibratedMeals);

  return res.json({
    ok: true,
    scaled: false,
    tolerance: MACRO_TOLERANCE,
    coverage,
    targetTotals,
    totalsDbBefore,
    totalsDbAfter,
    variantCalibrated,
    mapped,
    displayMeals,
  });
}


    // 7) Skalowanie w pętli (max SCALE_ITERATIONS)
    // 7) Skalowanie w pętli (max SCALE_ITERATIONS)
// 7) Skalowanie w pętli (max SCALE_ITERATIONS)
// 7) Skalowanie w pętli (max SCALE_ITERATIONS)
let after = before;
for (let i = 0; i < SCALE_ITERATIONS; i++) {
  const relDiff = computeRelativeDiff(after.dayTotals, targetTotals);

//   console.log(
//     `[AI-TEST] Iteracja ${i + 1}, relative diff:`,
//     relDiff
//   );

  if (!needsScaling(relDiff)) {
    // console.log(
    //   `[AI-TEST] Różnice w makrach w granicach tolerancji ${
    //     MACRO_TOLERANCE * 100
    //   }% – koniec skalowania`
    // );
    break;
  }

  // wybieramy makro z największym odchyleniem i tryb (up = deficyt, down = nadwyżka)
  const step = computeMacroScaleStep(
    calibratedMeals,
    after.dayTotals,
    targetTotals
  );

  if (
    !step.macro ||
    !step.mode ||
    !step.richCount ||
    !Number.isFinite(step.factor) ||
    Math.abs(step.factor - 1) < 1e-3
  ) {
    // console.log(
    //   `[AI-TEST] Brak sensownego kroku skalowania (macro=${step.macro}, mode=${step.mode}, factor=${step.factor}) – przerywam`
    // );
    break;
  }

//   console.log(
//     `[AI-TEST] Iteracja ${i + 1}, tryb=${step.mode}, skaluję produkty bogate w ${step.macro} (count=${step.richCount}) współczynnikiem = ${step.factor}`
//   );

  // skalujemy TYLKO produkty bogate w wybrane makro
  for (const meal of calibratedMeals) {
    for (const item of meal.items || []) {
      const per100 = item.per100;
      if (!per100) continue;
      const density = toNum(per100[step.macro], 0);
      if (density <= 0.5) continue; // pomiń śladowe ilości
      item.grams = item.grams * step.factor;
    }
  }

  // przelicz makra po skalowaniu + odśwież item.macros / item.per100
  after = computePlanMacros(calibratedMeals, productById);
//   console.log(
//     `[AI-TEST] Totals z bazy PO skalowaniu (iteracja ${i + 1}):`,
//     after.dayTotals
//   );
}



    const totalsAfter = after.dayTotals;

        const totalsDbBefore = totalsBefore;
    const totalsDbAfter = totalsAfter;

    // podkładamy przeliczone totals do wariantu
    const variantCalibrated = {
      title: variant.title || 'Jadłospis dnia',
      description: variant.description || '',
      totalsTarget: targetTotals,
      totalsDbBefore: totalsBefore,
      totalsDbAfter: totalsAfter,
      meals: calibratedMeals.map((m) => ({
        slot: m.slot,
        totals: m.totals,
        items: m.items,
      })),
    };

    const displayMeals = buildDisplayMeals(calibratedMeals);

    return res.json({
      ok: true,
      tolerance: MACRO_TOLERANCE,
      targetTotals,
      totalsDbBefore,
      totalsDbAfter,
      variantCalibrated,
      mapped,
      displayMeals,
    });
  } catch (e) {
    console.error('[AI-TEST] Nieoczekiwany błąd:', e);
    return res.status(500).json({
      ok: false,
      message: 'Nieoczekiwany błąd po stronie serwera AI-test.',
    });
  }
});

module.exports = router;
