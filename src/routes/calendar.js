// src/routes/calendar.js
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const auth = require('../middleware/auth');           // Bearer JWT -> req.user.id
const { DiaryEntry, MEAL_SLOTS } = require('../models/DiaryEntry');
const { Product } = require('../models/Product');

// ── Walidacje ─────────────────────────────────────────────────────────────────
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format YYYY-MM-DD');
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Nieprawidłowe ID');
const gramsPos = z.preprocess(v => Number(v), z.number().min(1));
const slotStr  = z.string().refine(v => MEAL_SLOTS.includes(v), 'Nieprawidłowy slot');

// ── Helper: bezpieczna liczba ───────────────────────────────────────────────
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Helper: policz makra dla produktu i gramatury ───────────────────────────
function calcMacros(product, grams) {
  const factor = (Number(grams) || 0) / 100;

  const kcal100 = toNum(product?.kcal100);
  const p100 = toNum(product?.p100);
  const f100 = toNum(product?.f100);
  const c100 = toNum(product?.c100);

  return {
    kcal: (kcal100 ?? 0) * factor,
    protein: (p100 ?? 0) * factor,
    fat: (f100 ?? 0) * factor,
    carbs: (c100 ?? 0) * factor,
  };
}

// ── Helper: wektor „makro na kcal” do porównywania proporcji ────────────────
function ratioVector(product) {
  const kcal100 = toNum(product?.kcal100);
  if (!kcal100 || kcal100 <= 0) return null;

  const p100 = toNum(product?.p100) ?? 0;
  const f100 = toNum(product?.f100) ?? 0;
  const c100 = toNum(product?.c100) ?? 0;

  // g białka/tłuszczu/węgli na 1 kcal – daje stabilne porównanie po przeskalowaniu gramatury
  return [p100 / kcal100, f100 / kcal100, c100 / kcal100];
}

function vecDist(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const d0 = a[0] - b[0];
  const d1 = a[1] - b[1];
  const d2 = a[2] - b[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

// ── Helper: pobierz albo utwórz entry dla (userId, date, slot) ───────────────
async function getOrCreateEntry(userId, date, slot) {
  let doc = await DiaryEntry.findOne({ userId, date, slot });
  if (!doc) doc = await DiaryEntry.create({ userId, date, slot, items: [] });
  return doc;
}

// ── GET /api/calendar/week?monday=YYYY-MM-DD ─────────────────────────────────
// Zwraca tydzień Pon–Niedz w kształcie wygodnym dla frontu
router.get('/week', auth, async (req, res) => {
  try {
    const monday = ymd.parse(req.query.monday || '');
    // policz wszystkie 7 dat
    const base = new Date(monday + 'T00:00:00Z');
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });

    // pobierz wszystkie wpisy tygodnia
    const entries = await DiaryEntry.find({
      userId: req.user.id,
      date: { $in: days }
    }).populate({ path: 'items.productId', select: 'name category kcal100 p100 f100 c100' });

    // zbuduj strukturę: { [iso]: [ { name, items:[...]} x5 ] }
    const emptyMeals = () => MEAL_SLOTS.map(name => ({ name, items: [] }));
    const out = {};
    days.forEach(d => (out[d] = emptyMeals()));

    for (const e of entries) {
      const idx = MEAL_SLOTS.indexOf(e.slot);
      if (idx === -1) continue;
      out[e.date][idx].items = e.items.map(it => {
        const p = it.productId && it.productId.name ? it.productId : null;
        // policz makra dla grams na podstawie per-100g z produktu
        const factor = (it.grams || 0) / 100;
        const kcal = p?.kcal100 != null ? p.kcal100 * factor : 0;
        const protein = p?.p100 != null ? p.p100 * factor : 0;
        const fat = p?.f100 != null ? p.f100 * factor : 0;
        const carbs = p?.c100 != null ? p.c100 * factor : 0;

        return {
          id: String(it._id),
          name: p ? p.name : 'Pozycja',
          grams: it.grams,
          kcal, protein, fat, carbs,
          productCategory: p?.category || null,
          productId: p ? String(p._id) : null,
        };
      });
    }

    res.json({ week: out, slots: MEAL_SLOTS });
  } catch (e) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ message: e.errors?.[0]?.message || 'Błędne parametry' });
    }
    console.error('GET /calendar/week error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// ── GET /api/calendar/:date/:slot/items/:itemId/substitutes?limit=5 ─────────
// Zwraca do 5 zamienników z tej samej kategorii z możliwie podobnymi proporcjami makro
router.get('/:date/:slot/items/:itemId/substitutes', auth, async (req, res) => {
  try {
    const date = ymd.parse(req.params.date);
    const slot = slotStr.parse(req.params.slot);
    const itemId = objectId.parse(req.params.itemId);
    const limit = z.preprocess(v => Number(v), z.number().int().min(1).max(5)).parse(req.query.limit ?? 5);

    const entry = await DiaryEntry.findOne({ userId: req.user.id, date, slot })
      .populate({ path: 'items.productId', select: 'name category kcal100 p100 f100 c100' });

    if (!entry) return res.status(404).json({ message: 'Brak wpisu' });

    const it = (entry.items || []).find(x => String(x._id) === itemId);
    if (!it) return res.status(404).json({ message: 'Pozycja nie istnieje' });

    // produkt źródłowy
    let src = it.productId && it.productId.name ? it.productId : null;
    if (!src && it.productId) {
      src = await Product.findById(it.productId).select('name category kcal100 p100 f100 c100').lean();
    }
    if (!src) return res.status(404).json({ message: 'Produkt pozycji nie istnieje' });

    const srcCategory = src.category || null;
    if (!srcCategory) {
      return res.json({
        original: {
          itemId,
          productId: String(src._id),
          name: src.name,
          category: null,
          grams: it.grams,
          macros: calcMacros(src, it.grams),
        },
        suggestions: [],
      });
    }

    const srcTotals = calcMacros(src, it.grams);
    const srcVec = ratioVector(src);

    // pobierz kandydatów z tej samej kategorii
    const candidates = await Product.find({
      category: srcCategory,
      _id: { $ne: src._id },
    })
      .select('name category kcal100 p100 f100 c100')
      .limit(300)
      .lean();

    const scored = (candidates || [])
      .map((p) => {
        const kcal100 = toNum(p.kcal100);
        if (!kcal100 || kcal100 <= 0) return null;

        const dist = vecDist(srcVec, ratioVector(p));

        // sugerowana gramatura: skaluj do tych samych kcal co oryginał
        let gramsSuggested = Number(it.grams) || 0;
        if ((srcTotals.kcal || 0) > 0) {
          gramsSuggested = Math.round((srcTotals.kcal / kcal100) * 100);
        }
        if (!gramsSuggested || gramsSuggested < 1) gramsSuggested = 1;

        const newTotals = calcMacros(p, gramsSuggested);

        return {
          score: dist,
          productId: String(p._id),
          name: p.name,
          category: p.category,
          gramsSuggested,
          macros: newTotals,
          diff: {
            kcal: newTotals.kcal - (srcTotals.kcal || 0),
            protein: newTotals.protein - (srcTotals.protein || 0),
            fat: newTotals.fat - (srcTotals.fat || 0),
            carbs: newTotals.carbs - (srcTotals.carbs || 0),
          },
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    res.json({
      original: {
        itemId,
        productId: String(src._id),
        name: src.name,
        category: srcCategory,
        grams: it.grams,
        macros: srcTotals,
      },
      suggestions: scored,
    });
  } catch (e) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ message: e.errors?.[0]?.message || 'Błędne dane' });
    }
    console.error('GET /calendar substitutes error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// ── PATCH /api/calendar/:date/:slot/items/:itemId/replace  { productId, grams? } ──
router.patch('/:date/:slot/items/:itemId/replace', auth, async (req, res) => {
  try {
    const date = ymd.parse(req.params.date);
    const slot = slotStr.parse(req.params.slot);
    const itemId = objectId.parse(req.params.itemId);
    const body = z.object({
      productId: objectId,
      grams: gramsPos.optional(),
    }).parse(req.body || {});

    const prod = await Product.findById(body.productId).lean();
    if (!prod) return res.status(404).json({ message: 'Produkt nie istnieje' });

    const entry = await DiaryEntry.findOne({ userId: req.user.id, date, slot });
    if (!entry) return res.status(404).json({ message: 'Brak wpisu' });

    const idx = (entry.items || []).findIndex(x => String(x._id) === itemId);
    if (idx === -1) return res.status(404).json({ message: 'Pozycja nie istnieje' });

    entry.items[idx].productId = body.productId;
    if (body.grams != null) entry.items[idx].grams = body.grams;

    await entry.save();
    res.json({ ok: true });
  } catch (e) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ message: e.errors?.[0]?.message || 'Błędne dane' });
    }
    console.error('PATCH /calendar replace item error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// ── POST /api/calendar/:date/:slot/items  { productId, grams } ───────────────
router.post('/:date/:slot/items', auth, async (req, res) => {
  try {
    const date = ymd.parse(req.params.date);
    const slot = slotStr.parse(req.params.slot);
    const body = z.object({
      productId: objectId,
      grams: gramsPos,
    }).parse(req.body || {});

    // walidacja produktu (może być globalny)
    const prod = await Product.findById(body.productId).lean();
    if (!prod) return res.status(404).json({ message: 'Produkt nie istnieje' });

    const entry = await getOrCreateEntry(req.user.id, date, slot);
    entry.items.push({ productId: body.productId, grams: body.grams });
    await entry.save();

    return res.status(201).json({ ok: true, id: String(entry._id) });
  } catch (e) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ message: e.errors?.[0]?.message || 'Błędne dane' });
    }
    console.error('POST /calendar add item error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// ── DELETE /api/calendar/:date/:slot/items/:itemId ───────────────────────────
router.delete('/:date/:slot/items/:itemId', auth, async (req, res) => {
  try {
    const date = ymd.parse(req.params.date);
    const slot = slotStr.parse(req.params.slot);
    const itemId = objectId.parse(req.params.itemId);

    const entry = await DiaryEntry.findOne({ userId: req.user.id, date, slot });
    if (!entry) return res.status(404).json({ message: 'Brak wpisu' });

    const before = entry.items.length;
    entry.items = entry.items.filter(it => String(it._id) !== itemId);
    if (entry.items.length === before) {
      return res.status(404).json({ message: 'Pozycja nie istnieje' });
    }
    await entry.save();
    res.json({ ok: true });
  } catch (e) {
    if (e?.name === 'ZodError') {
      return res.status(400).json({ message: e.errors?.[0]?.message || 'Błędne dane' });
    }
    console.error('DELETE /calendar item error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// ── DELETE /api/calendar/:date  (wyczyść cały dzień) ─────────────────────────
router.delete('/:date', auth, async (req, res) => {
  try {
    const date = ymd.parse(req.params.date);
    await DiaryEntry.deleteMany({ userId: req.user.id, date });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /calendar/:date error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
