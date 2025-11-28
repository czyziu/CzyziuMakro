// src/routes/ai-day-plan.js
// Endpoint: POST /api/ai/day-plan
// Generuje cały dzień (5 posiłków) na podstawie makr i prompta użytkownika,
// używając tylko Ollama. Wersja "bardziej restrykcyjna" względem makro.

const express = require('express');
const router = express.Router();

// Polyfill fetch dla Node < 18
if (typeof fetch !== 'function') {
  global.fetch = (...args) =>
    import('node-fetch').then(({ default: f }) => f(...args));
}

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:14b-instruct';



// 5 slotów – jak w UI/kalendarzu
const MEAL_SLOTS = [
  { id: 'breakfast',        label: 'Śniadanie' },
  { id: 'second_breakfast', label: 'II śniadanie' },
  { id: 'lunch',            label: 'Obiad' },
  { id: 'snack',            label: 'Podwieczorek' },
  { id: 'dinner',           label: 'Kolacja' },
];

// Domyślny podział kcal: 20 / 15 / 30 / 15 / 20
const DEFAULT_RATIOS = [0.20, 0.15, 0.30, 0.15, 0.20];

// Domyślna tolerancja makro w skali dnia: ±5% (można nadpisać w body.macroTolerancePct)
const DEFAULT_MACRO_TOL_PCT = Number(process.env.AI_DAYPLAN_MACRO_TOL || '0.05');

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// Rozbicie dziennych makr na posiłki wg procentów kcal
function splitTargetsIntoMeals(dailyTargets, ratios) {
  const r =
    Array.isArray(ratios) && ratios.length === MEAL_SLOTS.length
      ? ratios
      : DEFAULT_RATIOS;

  const sum = r.reduce((acc, x) => acc + Math.max(0, x), 0) || 1;
  const shares = r.map((x) => Math.max(0, x) / sum); // przeskalowane do 1.0

  const out = [];
  let accK = 0,
    accP = 0,
    accF = 0,
    accC = 0;

  MEAL_SLOTS.forEach((slot, idx) => {
    let kcal, protein, fat, carbs;
    if (idx < MEAL_SLOTS.length - 1) {
      kcal = Math.round(dailyTargets.kcal * shares[idx]);
      protein = Math.round(dailyTargets.protein * shares[idx]);
      fat = Math.round(dailyTargets.fat * shares[idx]);
      carbs = Math.round(dailyTargets.carbs * shares[idx]);

      accK += kcal;
      accP += protein;
      accF += fat;
      accC += carbs;
    } else {
      // ostatni posiłek łapie różnice zaokrągleń
      kcal = dailyTargets.kcal - accK;
      protein = dailyTargets.protein - accP;
      fat = dailyTargets.fat - accF;
      carbs = dailyTargets.carbs - accC;
    }

    out.push({
      id: slot.id,
      label: slot.label,
      targets: { kcal, protein, fat, carbs },
    });
  });

  return out;
}

// Proste wywołanie Ollamy z format: 'json'
async function callOllamaJson({ systemPrompt, userPrompt, temperature = 0.25 }) {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: { temperature },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  const msg = data?.message;
  const content = msg?.content ?? data?.content;

  if (!content) {
    throw new Error('Pusta odpowiedź od modelu (brak content).');
  }

  if (typeof content === 'object') {
    // przy format: 'json' Ollama często zwraca już obiekt
    return content;
  }

  try {
    return JSON.parse(content);
  } catch (_err) {
    throw new Error('Nie udało się sparsować JSON z odpowiedzi AI.');
  }
}

// POST /api/ai/day-plan
router.post('/day-plan', async (req, res) => {
  try {
    const body = req.body || {};
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const t = body.targets || {};

    const dailyTargets = {
      kcal: Math.round(toNum(t.kcal ?? t.calories ?? t.energy, 0)),
      protein: Math.round(toNum(t.protein ?? t.B ?? t.bialko, 0)),
      fat: Math.round(toNum(t.fat ?? t.T ?? t.tluszcz, 0)),
      carbs: Math.round(toNum(t.carbs ?? t.W ?? t.wegle, 0)),
    };

    if (!dailyTargets.kcal) {
      return res
        .status(400)
        .json({ message: 'Brak dziennego celu kcal w polu "targets.kcal".' });
    }

    const nRaw =
      body.n ?? body.count ?? req.query.n ?? req.query.count ?? req.query.top;
    const nVariants = Math.max(1, Math.min(5, Number(nRaw) || 3));

    const ratios =
      Array.isArray(body.ratios) && body.ratios.length === MEAL_SLOTS.length
        ? body.ratios.map((x) => Number(x) || 0)
        : DEFAULT_RATIOS;

    // tolerancja makro w skali dnia (np. 0.05 => ±5%)
    const tolRaw =
      body.macroTolerancePct ??
      body.macroTolerance ??
      body.macro_tol ??
      DEFAULT_MACRO_TOL_PCT;
    const macroTolPct = Math.min(
      0.25,
      Math.max(0.01, Number(tolRaw) || DEFAULT_MACRO_TOL_PCT)
    );

    const mealsTargets = splitTargetsIntoMeals(dailyTargets, ratios);

    const tolPctStr = (macroTolPct * 100).toFixed(1).replace(/\.0$/, '');
    const kcalMin = Math.round(dailyTargets.kcal * (1 - macroTolPct));
    const kcalMax = Math.round(dailyTargets.kcal * (1 + macroTolPct));

const systemPrompt = `
Jesteś asystentem dietetycznym dla osoby trenującej siłowo.
Pracujesz w języku polskim.
Odpowiadasz TYLKO w poprawnym JSON-ie (bez komentarzy, bez tekstu poza JSON).

Priorytet #1: TRZYMAĆ SIĘ MAKR (WSZYSTKICH, NIE TYLKO BIAŁKA).
- W skali całego dnia suma makr ma być możliwie najbliżej celu:
  * kalorie w zakresie ok. ±${tolPctStr}% (preferuj delikatny niedobór niż nadwyżkę),
  * białko możliwie blisko wartości docelowej,
  * tłuszcz i węglowodany również możliwie blisko celu.
- Bardzo ważne: nie rób dni kulturystycznych z absurdalnie dużą ilością białka i prawie bez węglowodanów.
  * białko nie powinno przekraczać mniej więcej 110–120% wartości docelowej,
  * węglowodany nie powinny być mocno zaniżone – przy braku informacji o diecie keto
    unikaj planów, gdzie węglowodanów jest wyraźnie mniej niż w celu.
  * jeżeli w celach dziennych węglowodanów jest więcej niż białka,
    to w gotowym jadłospisie węglowodanów też musi być co najmniej tyle samo co białka.
- Posiłki mogą się minimalnie różnić od docelowych makr, ale suma dnia jest kluczowa.


Priorytet #2: SZANOWAĆ OPIS UŻYTKOWNIKA I PORY DNIA.
- Tekst użytkownika opisuje preferencje smakowe, produkty, pory dnia itp.
- MUSISZ je uwzględnić przy rozdzielaniu dań na konkretne posiłki.
- Przykład:
  * "rano coś na słono, a wieczorem coś na słodko" oznacza:
    - Śniadanie i II śniadanie → wyraźnie wytrawne/słone
      (np. jajka, sery, wędliny, pieczywo, wytrawne warzywa; unikaj typowych deserów,
       słodkich płatków, dużej ilości owoców).
    - Podwieczorek i Kolacja → wyraźnie na słodko
      (np. owsianka na słodko, naleśniki na słodko, deser białkowy, owoce z nabiałem, pudding białkowy).
- Podobne sformułowania ("lekko na noc", "więcej węgli po treningu" itp.)
  traktuj jako twarde wymagania przy przypisywaniu tego, co jemy, do pór dnia.

Dodatkowe zasady techniczne:
- Dokładnie 5 posiłków: Śniadanie, II śniadanie, Obiad, Podwieczorek, Kolacja.
- Każdy posiłek ma listę składników z gramaturą w gramach.
- Używaj normalnych produktów spożywczych dostępnych w Polsce.
- Unikaj skrajnie dziwnych kombinacji.
`;



const userPrompt = `
Opis / ograniczenia od użytkownika (to są ważne wymagania smakowe i dotyczące pór dnia):
"${prompt || 'brak dodatkowych preferencji'}"

Jeżeli w opisie pojawia się coś w stylu:
- "rano coś na słono, a wieczorem coś na słodko"
to znaczy, że:
- Śniadanie i II śniadanie mają być wyraźnie wytrawne/słone,
- Podwieczorek i Kolacja mają być wyraźnie na słodko.
Takie wymagania traktuj jako obowiązkowe przy tworzeniu jadłospisu.

Dzienne cele użytkownika (w przybliżeniu):
- kcal: ${dailyTargets.kcal}
- białko: ${dailyTargets.protein} g
- tłuszcz: ${dailyTargets.fat} g
- węglowodany: ${dailyTargets.carbs} g

Wymagania dotyczące MAKR:
- Suma kalorii w skali dnia powinna być możliwie blisko ${dailyTargets.kcal} kcal,
  najlepiej w zakresie ${kcalMin}–${kcalMax} kcal (±${tolPctStr}%).
- Suma białka, tłuszczu i węglowodanów w skali dnia powinna być jak najbliżej celu.
- Jeżeli musisz się pomylić:
  * wybieraj LEKKĄ niedowagę kaloryczną zamiast dużej nadwyżki,
  * nie zaniżaj mocno białka (powinno być raczej lekko powyżej niż poniżej celu,
    ale nie więcej niż ok. 110–120% celu),
  * NIE zaniżaj mocno węglowodanów – przy braku wyraźnej informacji o diecie keto
    unikaj planów, w których węglowodanów jest znacznie mniej niż w celu
    albo mniej niż białka, jeśli w celach jest odwrotnie.


Podziel dzień na 5 posiłków:
${mealsTargets
  .map(
    (m) =>
      `- ${m.label}: około ${m.targets.kcal} kcal, B ~${m.targets.protein} g, T ~${m.targets.fat} g, W ~${m.targets.carbs} g`
  )
  .join('\n')}

ZADANIE:
Przygotuj ${nVariants} różne warianty jadłospisu na jeden dzień (pole "variants").
Każdy wariant musi mieć dokładnie 5 POSIŁKÓW, po jednym na każdy slot.

Struktura odpowiedzi (JSON):

{
  "variants": [
    {
      "title": "krótki tytuł, np. 'Przykładowy dzień z owsianką i kurczakiem'",
      "summary": "1–2 zdania podsumowania dnia",
      "meals": [
        {
          "slot": "Śniadanie" | "II śniadanie" | "Obiad" | "Podwieczorek" | "Kolacja",
          "title": "nazwa posiłku, np. 'Owsianka z malinami'",
          "description": "krótki opis przygotowania (1–2 zdania)",
          "totals": {
            "kcal": 0,
            "protein": 0,
            "fat": 0,
            "carbs": 0
          },
          "items": [
            { "name": "produkt 1", "grams": 0 },
            { "name": "produkt 2", "grams": 0 }
          ]
        }
      ]
    }
  ]
}

WAŻNE:
- W obrębie jednego wariantu NIE powtarzaj dokładnie tych samych posiłków.
- Suma makr w skali dnia powinna być jak najbliżej celu (kalorie w podanym zakresie).
- Odpowiedź musi być WYŁĄCZNIE JSON-em zgodnym ze strukturą powyżej.
`;




    const raw = await callOllamaJson({
      systemPrompt,
      userPrompt,
      temperature: 0.2, // bardziej "techniczne", mniej fantazji
    });

    const variants = Array.isArray(raw?.variants) ? raw.variants : [];

    if (!variants.length) {
      return res.status(422).json({
        message: 'AI nie zwróciło żadnych wariantów jadłospisu.',
        raw,
      });
    }

    return res.json({
      dailyTargets,
      macroTolerancePct: macroTolPct,
      mealsTargets,
      variants: variants.slice(0, nVariants),
    });
  } catch (err) {
    console.error('[AI day-plan] error:', err);
    return res.status(500).json({
      message: 'Błąd asystenta AI (day-plan).',
      error: err.message || String(err),
    });
  }
});

module.exports = router;
