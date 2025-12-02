// src/routes/ai.js
// Asystent AI dla pojedynczego posiłku:
// - bierze prompt + opcjonalne makra dla dania
// - jeśli makra nie zostały podane (ani w body, ani w prompcie) → liczy je z dziennych makr wg 20/15/30/15/20
// - generuje posiłek przez Ollamę
// - kalibruje go przez /api/ai/day-plan/test (jak cały dzień)

const express = require('express');
const router = express.Router();

// 5 slotów jak w ai-day-plan.js
const MEAL_SLOTS = [
  { slot: 'Śniadanie',    share: 0.20 },
  { slot: 'II śniadanie', share: 0.15 },
  { slot: 'Obiad',        share: 0.30 },
  { slot: 'Podwieczorek', share: 0.15 },
  { slot: 'Kolacja',      share: 0.20 },
];

const SHARE_BY_SLOT = MEAL_SLOTS.reduce((acc, m) => {
  acc[m.slot] = m.share;
  return acc;
}, {});

// baza URL na ten sam serwer – jak w ai-test.js
const PORT = process.env.PORT || 4000;
const INTERNAL_BASE_URL =
  process.env.INTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;

// ===== Helpers ogólne =====

function toNum(v, def = 0) {
  if (v === null || v === undefined) return def;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

// dzienne cele (z profilu) – jak w ai-day-plan.js
function normalizeTargets(raw) {
  if (!raw || typeof raw !== 'object') {
    return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  }
  return {
    kcal: toNum(raw.kcal ?? raw.calories ?? raw.k, 0),
    protein: toNum(raw.protein ?? raw.p ?? raw.b, 0),
    fat: toNum(raw.fat ?? raw.f ?? raw.t, 0),
    carbs: toNum(raw.carbs ?? raw.c ?? raw.w, 0),
  };
}

// makra dla dania / posiłku – jak normalizeTotals w ai-test.js
function normalizeTotals(raw) {
  if (!raw || typeof raw !== 'object') {
    return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  }
  return {
    kcal: toNum(raw.kcal ?? raw.calories ?? raw.k, 0),
    protein: toNum(raw.protein ?? raw.p ?? raw.b, 0),
    fat: toNum(raw.fat ?? raw.f ?? raw.t, 0),
    carbs: toNum(raw.carbs ?? raw.c ?? raw.w, 0),
  };
}

// Normalizacja posiłków z odpowiedzi AI do formatu, który rozumie backend/front
// Oparte bezpośrednio na ai-day-plan.js
function normalizeMeals(rawMeals = []) {
  return rawMeals.map((m) => {
    const slot = (m.slot || m.name || '').trim() || 'Posiłek';

    const rawItems = Array.isArray(m.items)
      ? m.items
      : Array.isArray(m.products)
      ? m.products
      : [];

    const items = rawItems.map((p) => ({
      name: String(p.name || p.product || 'Produkt').trim(),
      grams: toNum(p.grams ?? p.amount ?? p.weight, 0),
    }));

    const t = m.totals || {};
    const kcal =
      toNum(m.kcal, NaN) ||
      toNum(t.kcal, 0);
    const protein =
      toNum(m.protein, NaN) ||
      toNum(t.protein, 0);
    const fat =
      toNum(m.fat, NaN) ||
      toNum(t.fat, 0);
    const carbs =
      toNum(m.carbs, NaN) ||
      toNum(t.carbs, 0);

    return {
      slot,
      items,
      totals: {
        kcal: toNum(kcal, 0),
        protein: toNum(protein, 0),
        fat: toNum(fat, 0),
        carbs: toNum(carbs, 0),
      },
    };
  });
}

// wyliczenie docelowych makr dla dania na podstawie dziennych celów + slotu
function calcMealTotalsFromDay(dayTargets, slotName) {
  const share = SHARE_BY_SLOT[slotName] ?? 0.20; // default 20%
  const t = normalizeTargets(dayTargets);

  const kcal = Math.round((t.kcal || 0) * share);
  const protein = Math.round((t.protein || 0) * share);
  const fat = Math.round((t.fat || 0) * share);
  const carbs = Math.round((t.carbs || 0) * share);

  return { kcal, protein, fat, carbs };
}

// fallback, gdy nie mamy ani makr dania, ani dziennych celów
function fallbackMealTotals(slotName) {
  // np. dzień 2200 kcal, 140 B, 70 T, 240 W – czysto orientacyjnie
  const fallbackDay = {
    kcal: 2200,
    protein: 140,
    fat: 70,
    carbs: 240,
  };
  return calcMealTotalsFromDay(fallbackDay, slotName);
}

// ===== Parsowanie makr z promptu użytkownika =====
//
// Użytkownik może napisać np.:
// "zrób obiad 650 kcal 40g białka 20g tłuszczu 70g węgli"
// "Śniadanie 500kcal B30 T15 W50"
// "kolacja ok. 600 kcal, białko 45g, tłuszcz 20 g, węgle 55 g"
//
function parseMacrosFromPrompt(promptText) {
  if (!promptText || typeof promptText !== 'string') {
    return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  }

  const text = promptText.toLowerCase();
  const out = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

  // kcal – "650 kcal", "2000kcal", "1800 kalorii"
  const kcalMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:kcal|kilokalorii|kalorii|kalorie)/i);
  if (kcalMatch) {
    out.kcal = toNum(kcalMatch[1], 0);
  }

  // wzór typu "B30 T15 W50"
  const compactMatch = text.match(/\bb\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g?\s+t\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g?\s+w\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g?\b/);
  if (compactMatch) {
    const [, b, t, w] = compactMatch;
    out.protein = toNum(b, out.protein || 0);
    out.fat = toNum(t, out.fat || 0);
    out.carbs = toNum(w, out.carbs || 0);
  }

  // białko
  const proteinPatterns = [
    /białk[aoiu]?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g/,
    /\bb\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g?\b/,
  ];
  for (const re of proteinPatterns) {
    const m = text.match(re);
    if (m) {
      out.protein = toNum(m[1], out.protein || 0);
      break;
    }
  }

  // tłuszcz
  const fatPatterns = [
    /tłuszcz(?:u|em|ów)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g/,
    /\bt\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g?\b/,
  ];
  for (const re of fatPatterns) {
    const m = text.match(re);
    if (m) {
      out.fat = toNum(m[1], out.fat || 0);
      break;
    }
  }

  // węglowodany / węgle
  const carbPatterns = [
    /węglowodan(?:y|ów)?\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g/,
    /węgl[ia]\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g/,
    /\bw\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*g?\b/,
  ];
  for (const re of carbPatterns) {
    const m = text.match(re);
    if (m) {
      out.carbs = toNum(m[1], out.carbs || 0);
      break;
    }
  }

  return out;
}

function hasAnyMacro(totals) {
  if (!totals) return false;
  return !!(totals.kcal || totals.protein || totals.fat || totals.carbs);
}

// ===== ENDPOINT: POST /api/ai/meal =====
//
// Body (propozycja):
// {
//   "prompt": "opis / preferencje + opcjonalne makra np. 'obiad 650 kcal B40 T15 W70'",
//   "slot": "Śniadanie" | "II śniadanie" | "Obiad" | "Podwieczorek" | "Kolacja",
//   "mealTotals": { kcal, protein, fat, carbs }, // opcjonalne makra dla DANIA z formularza
//   "targets":    { kcal, protein, fat, carbs }  // opcjonalne cele DZIENNE (jak w ai-day-plan)
// }
//
// Zasada priorytetów makr dla dania:
// 1) Jeśli w prompcie są makra → bierzemy je (nadpisują puste wartości z body)
// 2) Jeśli dalej brakuje / nie ma makr dania → liczymy z targets wg 20/15/30/15/20
// 3) Jeśli nadal wszystko 0 → fallback (dzień 2200 kcal itp.)
//
// Zwraca:
// {
//   ok: true,
//   slot,
//   targetTotals: { ...makra celu dla posiłku... },
//   variant,                // wariant POSIŁKU od AI (1 posiłek w tablicy meals)
//   calibration,            // pełna odpowiedź z /api/ai/day-plan/test (jeśli się udało)
//   variantCalibrated       // wariant po kalibracji (jeśli się udało)
// }

router.post('/meal', async (req, res) => {
  try {
    const { prompt, slot, mealTotals: rawMealTotals, targets: rawDayTargets } =
      req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, message: 'Brak promptu dla AI.' });
    }

    const slotName = (slot && String(slot).trim()) || 'Posiłek';

    // 1) Makra z body
    let mealTotals = normalizeTotals(rawMealTotals);
    const hasMealFromBody = hasAnyMacro(mealTotals);

    // 2) Makra zaszyte w prompcie (użytkownik pisze np. "obiad 650 kcal 40g białka 20g tłuszczu 70g węgli")
    const macrosFromPrompt = parseMacrosFromPrompt(prompt);
    const hasMealFromPrompt = hasAnyMacro(macrosFromPrompt);

    // jeśli w prompcie są makra – nadpisują / uzupełniają to, co przyszło z body
    if (hasMealFromPrompt) {
      if (!hasMealFromBody) {
        mealTotals = macrosFromPrompt;
      } else {
        // uzupełnij tylko brakujące z body
        if (!mealTotals.kcal && macrosFromPrompt.kcal) {
          mealTotals.kcal = macrosFromPrompt.kcal;
        }
        if (!mealTotals.protein && macrosFromPrompt.protein) {
          mealTotals.protein = macrosFromPrompt.protein;
        }
        if (!mealTotals.fat && macrosFromPrompt.fat) {
          mealTotals.fat = macrosFromPrompt.fat;
        }
        if (!mealTotals.carbs && macrosFromPrompt.carbs) {
          mealTotals.carbs = macrosFromPrompt.carbs;
        }
      }
    }

    // 3) Jeśli nadal nie mamy makr dania → licz z dziennych celów wg udziału 20/15/30/15/20
    if (!hasAnyMacro(mealTotals)) {
      const dayTargets = normalizeTargets(rawDayTargets);
      const fromDay = calcMealTotalsFromDay(dayTargets, slotName);
      if (hasAnyMacro(fromDay)) {
        mealTotals = fromDay;
      }
    }

    // 4) Jeśli wciąż nic – ostateczny fallback
    if (!hasAnyMacro(mealTotals)) {
      mealTotals = fallbackMealTotals(slotName);
    }

    // 5) Przygotowanie promptu dla Ollamy
    const hostRaw = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    const host = hostRaw.replace(/\/+$/, '');
    const model = process.env.OLLAMA_MODEL;

    if (!model) {
      return res.status(500).json({
        ok: false,
        message:
          'Brak konfiguracji modelu Ollama (zmienna OLLAMA_MODEL).',
      });
    }

    const systemPrompt = `
Jesteś asystentem dietetycznym.

Masz przygotować **JEDEN posiłek** dla slotu: "${slotName}".

Cel makroskładników dla TEGO posiłku (wartości orientacyjne, możesz delikatnie zaokrąglać):
- kalorie: ~${Math.round(mealTotals.kcal || 0)} kcal
- białko: ~${Math.round(mealTotals.protein || 0)} g
- tłuszcz: ~${Math.round(mealTotals.fat || 0)} g
- węglowodany: ~${Math.round(mealTotals.carbs || 0)} g

Zwróć **WYŁĄCZNIE** poprawny JSON, bez dodatkowego tekstu, bez markdown.

Struktura JSON:

{
  "title": "krótki tytuł posiłku",
  "description": "1-2 zdania opisu po polsku",
  "meals": [
    {
      "slot": "${slotName}",
      "totals": {
        "kcal": liczba,
        "protein": liczba,
        "fat": liczba,
        "carbs": liczba
      },
      "items": [
        { "name": "nazwa produktu", "grams": liczba },
        ...
      ]
    }
  ]
}

Ważne:
- Zwróć dokładnie JEDEN posiłek w tablicy "meals".
- Użyj dokładnie takiej nazwy slotu jak podana wyżej w polu "slot".
- "items" to lista prostych produktów (np. "jajka", "ryż", "pierś z kurczaka", "oliwa z oliwek", "jogurt naturalny") z gramaturą.
- Nazwy i opis po polsku.
- Postaraj się, aby makroskładniki tego posiłku były możliwie bliskie podanym celom.
`.trim();

    const userContext = `
Dodatkowy opis / preferencje od użytkownika (mogą zawierać także makro dla posiłku):
${prompt}
    `.trim();

    const ollamaResp = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContext },
        ],
      }),
    });

    if (!ollamaResp.ok) {
      const text = await ollamaResp.text().catch(() => '');
      return res.status(502).json({
        ok: false,
        message: 'Błąd wywołania Ollama.',
        status: ollamaResp.status,
        detail: text.slice(0, 500),
      });
    }

    const ollamaJson = await ollamaResp.json();
    const content = (ollamaJson?.message?.content || '').trim();

    if (!content) {
      return res.status(502).json({
        ok: false,
        message: 'Pusta odpowiedź od modelu.',
      });
    }

    // 6) Parsowanie JSON z odpowiedzi
    let parsed;
    try {
      let txt = content;
      const first = txt.indexOf('{');
      const last = txt.lastIndexOf('}');
      if (first !== -1 && last !== -1) {
        txt = txt.slice(first, last + 1);
      }
      parsed = JSON.parse(txt);
    } catch (e) {
      return res.status(502).json({
        ok: false,
        message: 'Odpowiedź AI nie jest poprawnym JSON-em.',
        raw: content.slice(0, 1000),
      });
    }

    let rawMeals = [];
    if (Array.isArray(parsed.meals) && parsed.meals.length) {
      rawMeals = parsed.meals;
    } else if (parsed.meal && typeof parsed.meal === 'object') {
      rawMeals = [parsed.meal];
    } else if (Array.isArray(parsed.items)) {
      rawMeals = [
        {
          slot: slotName,
          totals: parsed.totals || {},
          items: parsed.items,
        },
      ];
    }

    if (!rawMeals.length) {
      return res.status(502).json({
        ok: false,
        message: 'Model nie zwrócił żadnego posiłku w polu "meals".',
        raw: parsed,
      });
    }

    const normalizedMeals = normalizeMeals(rawMeals);
    const meal = {
      ...normalizedMeals[0],
      slot: slotName,
    };

    // UWAGA: totals wariantu ustawiamy na cel dla tego posiłku,
    // żeby /day-plan/test skalibrował go dokładnie do tych wartości.
    const variant = {
      title: parsed.title || `Posiłek: ${slotName}`,
      description: parsed.description || '',
      totals: mealTotals,
      meals: [meal],
    };

    // 7) Kalibracja – używamy istniejącego endpointu /api/ai/day-plan/test
    let calibration = null;

    try {
      const calResp = await fetch(
        `${INTERNAL_BASE_URL}/api/ai/day-plan/test`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(req.headers.authorization
              ? { Authorization: req.headers.authorization }
              : {}),
          },
          body: JSON.stringify({ variant }),
        }
      );

      if (calResp.ok) {
        calibration = await calResp.json();
      } else {
        let msg = `HTTP ${calResp.status} przy /api/ai/day-plan/test`;
        try {
          const j = await calResp.json();
          if (j?.message) msg = j.message;
        } catch {
          /* ignore */
        }
        console.warn('[AI-MEAL] Błąd kalibracji:', msg);
      }
    } catch (e) {
      console.warn('[AI-MEAL] Wyjątek przy kalibracji posiłku:', e);
    }

    const resp = {
      ok: true,
      slot: slotName,
      targetTotals: mealTotals,
      variant,
    };

    if (
      calibration &&
      calibration.ok !== false &&
      calibration.variantCalibrated
    ) {
      resp.calibration = calibration;
      resp.variantCalibrated = calibration.variantCalibrated;
    }

    return res.json(resp);
  } catch (err) {
    console.error('AI meal error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Nie udało się wygenerować posiłku.',
    });
  }
});

module.exports = router;
