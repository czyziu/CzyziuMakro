// src/routes/ai-day-plan.js
// Generowanie jadłospisu dnia (5 posiłków) za pomocą Ollama.

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth'); // Bearer JWT -> req.user.id
const FridgeItem = require('../models/FridgeItem');

// optional auth: jeśli jest Authorization to próbujemy ustawić req.user, a jak nie ma — lecimy dalej
function optionalAuth(req, res, next) {
  if (req.headers?.authorization) return auth(req, res, next);
  return next();
}

// 5 posiłków z podziałem 20/15/30/15/20
const MEAL_SLOTS = [
  { slot: 'Śniadanie', share: 0.20 },
  { slot: 'II śniadanie', share: 0.15 },
  { slot: 'Obiad', share: 0.30 },
  { slot: 'Podwieczorek', share: 0.15 },
  { slot: 'Kolacja', share: 0.20 },
];

// ===== Helpers =====
function toNum(v, def = 0) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

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

function calcMealTargets(dayKcal) {
  const total = toNum(dayKcal, 0);
  return MEAL_SLOTS.map((m) => ({
    slot: m.slot,
    share: m.share,
    targetKcal: Math.round(total * m.share),
  }));
}

// Normalizacja posiłków z odpowiedzi AI do formatu, który rozumie frontend
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
    const kcal = toNum(m.kcal, NaN) || toNum(t.kcal, 0);
    const protein = toNum(m.protein, NaN) || toNum(t.protein, 0);
    const fat = toNum(m.fat, NaN) || toNum(t.fat, 0);
    const carbs = toNum(m.carbs, NaN) || toNum(t.carbs, 0);

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

function fmtDateYYYYMMDD(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function normalizeFridgeItemsFromBody(fridgeItems) {
  if (!Array.isArray(fridgeItems)) return [];
  return fridgeItems
    .map((it) => ({
      name: String(it?.product?.name || it?.name || 'Produkt').trim(),
      grams: toNum(it?.grams, 0),
      expiresAt: it?.expiresAt || null,
    }))
    .filter((x) => x.name && x.grams > 0);
}

async function loadFridgeItemsFromDb(userId) {
  if (!userId) return [];
  const items = await FridgeItem.find({ userId })
    .populate({ path: 'productId', select: 'name' })
    .lean();

  return (items || [])
    .map((it) => ({
      name: String(it?.productId?.name || 'Produkt').trim(),
      grams: toNum(it?.grams, 0),
      expiresAt: it?.expiresAt || null,
    }))
    .filter((x) => x.name && x.grams > 0);
}

function fridgeToPromptText(items) {
  if (!items || !items.length) return '— (brak / pusto)';

  // sort: najpierw z datą, od najbliższej; potem bez daty
  const sorted = [...items].sort((a, b) => {
    const da = fmtDateYYYYMMDD(a.expiresAt);
    const db = fmtDateYYYYMMDD(b.expiresAt);
    if (da && db) return da.localeCompare(db);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return 0;
  });

  return sorted
    .map((it) => {
      const exp = fmtDateYYYYMMDD(it.expiresAt);
      return `- ${it.name}: ${Math.round(it.grams)} g${exp ? ` (ważne do ${exp})` : ''}`;
    })
    .join('\n');
}

// ===== Główny endpoint: POST /api/ai/day-plan =====
// Uwaga: w app.js będziemy montować router pod "/api/ai/day-plan"
// więc tutaj ścieżka to tylko "/".
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { prompt, targets: rawTargets, fridgeItems: fridgeItemsFromBody } = req.body || {};

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'Brak promptu dla AI.' });
    }

    // kaloryka „z bazy” – przychodzi z frontu w body.targets
    const targets = normalizeTargets(rawTargets);
    const dayKcal = targets.kcal || 0;

    const mealTargets = calcMealTargets(dayKcal);

    const macroTargets = {
      protein: targets.protein || 0,
      fat: targets.fat || 0,
      carbs: targets.carbs || 0,
    };

    const mealMacroTargets = MEAL_SLOTS.map((m) => ({
      slot: m.slot,
      share: m.share,
      protein: Math.round(macroTargets.protein * m.share),
      fat: Math.round(macroTargets.fat * m.share),
      carbs: Math.round(macroTargets.carbs * m.share),
    }));

    // ===== LODÓWKA (priorytet #2) =====
    let fridgeItems = normalizeFridgeItemsFromBody(fridgeItemsFromBody);

    if (!fridgeItems.length && req.user?.id) {
      try {
        fridgeItems = await loadFridgeItemsFromDb(req.user.id);
      } catch (e) {
        console.warn('[AI-DAY-PLAN] Nie udało się pobrać lodówki z DB:', e?.message || e);
        fridgeItems = [];
      }
    }

    const fridgeText = fridgeToPromptText(fridgeItems);

    const hostRaw = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    const host = hostRaw.replace(/\/+$/, '');
    const model = process.env.OLLAMA_MODEL;

    const systemPrompt = `
Jesteś asystentem dietetycznym.

PRIORYTETY (bardzo ważne):
1) Najpierw stosuj się do wymagań z promptu użytkownika (dieta, zakazy, preferencje, cel).
2) Następnie (jeśli nie koliduje z pkt 1) maksymalnie wykorzystuj produkty z lodówki, szczególnie te z krótką datą.
3) Dopiero na końcu dodawaj własne propozycje (minimalna liczba dodatkowych produktów).

Masz przygotować JEDEN plan dnia z 5 posiłkami:
- Śniadanie
- II śniadanie
- Obiad
- Podwieczorek
- Kolacja

Dzienna kaloryczność powinna być zbliżona do ~${Math.round(dayKcal || 0)} kcal
(jeśli 0, to ułóż rozsądny dzień np. 2000–2500 kcal).

Dzienny cel makroskładników (z bazy użytkownika, wartości orientacyjne):
- białko: ~${Math.round(macroTargets.protein || 0)} g
- tłuszcz: ~${Math.round(macroTargets.fat || 0)} g
- węglowodany: ~${Math.round(macroTargets.carbs || 0)} g

Podział kalorii na posiłki:
${mealTargets
  .map((m) => `- ${m.slot}: około ${m.targetKcal} kcal (${Math.round(m.share * 100)}%)`)
  .join('\n')}

Podział makroskładników na posiłki (wartości docelowe, możesz zaokrąglać):
${mealMacroTargets
  .map((m) => `- ${m.slot}: ~${m.protein} g białka, ~${m.fat} g tłuszczu, ~${m.carbs} g węglowodanów`)
  .join('\n')}

Zwróć **WYŁĄCZNIE** poprawny JSON, bez dodatkowego tekstu, bez markdown.

Struktura JSON:
{
  "title": "krótki tytuł dnia po polsku",
  "description": "1-2 zdania opisu po polsku",
  "meals": [
    {
      "slot": "Śniadanie" | "II śniadanie" | "Obiad" | "Podwieczorek" | "Kolacja",
      "totals": { "kcal": liczba, "protein": liczba, "fat": liczba, "carbs": liczba },
      "items": [ { "name": "nazwa produktu", "grams": liczba }, ... ]
    }
  ]
}

Ważne:
- ZAWSZE zwróć dokładnie 5 posiłków, po jednym dla każdego slotu.
- Używaj dokładnie takich nazw slotów: "Śniadanie", "II śniadanie", "Obiad", "Podwieczorek", "Kolacja".
- "items" to lista prostych produktów / SKŁADNIKÓW (nie gotowych dań) z gramaturą.
- Jeśli musisz dodać produkty spoza lodówki, dodaj ich jak najmniej (np. 0–5 na cały dzień).
- W polu "totals" wpisuj liczby (bez jednostek), staraj się trzymać celów kcal i makro.

Zwróć TYLKO jeden obiekt JSON dokładnie w opisanej strukturze, bez komentarzy i bez dodatkowych pól.
`.trim();

    const userContext = `
PROMPT UŻYTKOWNIKA (priorytet #1):
${prompt}

LODÓWKA — produkty dostępne do wykorzystania (priorytet #2):
${fridgeText}
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
        message: 'Błąd wywołania Ollama.',
        status: ollamaResp.status,
        detail: text.slice(0, 500),
      });
    }

    const ollamaJson = await ollamaResp.json();
    const content = (ollamaJson?.message?.content || '').trim();

    if (!content) {
      return res.status(502).json({ message: 'Pusta odpowiedź od modelu.' });
    }

    let parsed;
    try {
      let txt = content;
      const first = txt.indexOf('{');
      const last = txt.lastIndexOf('}');
      if (first !== -1 && last !== -1) txt = txt.slice(first, last + 1);
      parsed = JSON.parse(txt);
    } catch (e) {
      return res.status(502).json({
        message: 'Odpowiedź AI nie jest poprawnym JSON-em.',
        raw: content.slice(0, 1000),
      });
    }

    const rawMeals = Array.isArray(parsed.meals) ? parsed.meals : [];
    const meals = normalizeMeals(rawMeals);

    const totals = meals.reduce(
      (acc, m) => {
        acc.kcal += m.totals.kcal;
        acc.protein += m.totals.protein;
        acc.fat += m.totals.fat;
        acc.carbs += m.totals.carbs;
        return acc;
      },
      { kcal: 0, protein: 0, fat: 0, carbs: 0 }
    );

    const variant = {
      title: parsed.title || 'Jadłospis dnia',
      description: parsed.description || '',
      totals,
      meals,
    };

    const debug = req.query.debug === '1';

    if (debug) {
      return res.json({
        variants: [variant],
        debug: {
          mealTargets,
          targets,
          fridgeItems,
          ollamaRaw: ollamaJson,
        },
      });
    }

    return res.json({ variants: [variant] });
  } catch (err) {
    console.error('AI day-plan error:', err);
    return res.status(500).json({
      message: 'Nie udało się wygenerować jadłospisu dnia.',
    });
  }
});

module.exports = router;
