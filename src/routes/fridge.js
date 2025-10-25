// src/routes/fridge.js
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const auth = require('../middleware/auth'); // Bearer JWT -> req.user.id
const FridgeItem = require('../models/FridgeItem');
const { Product } = require('../models/Product');

// --- Schematy walidacji (Zod)
const objectId = z.string().min(1, 'productId wymagane');
const gramsPos  = z.number().positive('grams > 0');
const gramsNonNeg = z.number().min(0, 'grams >= 0');
const dateStrOpt   = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format YYYY-MM-DD').optional().nullable();


// GET /api/fridge  -> lista pozycji z dołączonym produktem
router.get('/', auth, async (req, res) => {
  try {
    const items = await FridgeItem
      .find({ userId: req.user.id })
      .populate({ path: 'productId', select: 'name category kcal100 p100 f100 c100' })
      .lean();

    // dopasuj shape do frontu: { id, productId, grams, product? }
    const mapped = items.map(it => ({
      id: String(it._id),
      productId: String(it.productId?._id || it.productId),
      grams: it.grams,
      expiresAt: it.expiresAt || null,
      product: it.productId && it.productId.name ? {
        id: String(it.productId._id),
        name: it.productId.name,
        category: it.productId.category || '',
        kcal100: it.productId.kcal100 ?? null,
        p100: it.productId.p100 ?? null,
        f100: it.productId.f100 ?? null,
        c100: it.productId.c100 ?? null
      } : null
    }));

    res.json({ items: mapped });
  } catch (e) {
    console.error('GET /fridge error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// POST /api/fridge  { productId, grams }
router.post('/', auth, async (req, res) => {
  try {
    const body = z.object({
      productId: objectId,
      grams: gramsPos,
      expiresAt: dateStrOpt // YYYY-MM-DD | null | undefined
    }).parse(req.body || {});

    // produkt może pochodzić od dowolnego użytkownika — ważne, że istnieje
    const prod = await Product.findById(body.productId).lean();
    if (!prod) return res.status(404).json({ message: 'Produkt nie istnieje' });

    // jeśli już istnieje pozycja — zwiększ ilość (i ewentualnie ustaw/wyczyść datę)
    const existing = await FridgeItem.findOne({ userId: req.user.id, productId: body.productId });
    if (existing) {
      existing.grams += body.grams;
      if (body.expiresAt !== undefined) {
        existing.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      }
      await existing.save();

      return res.json({
        id: String(existing._id),
        productId: String(existing.productId),
        grams: existing.grams,
        expiresAt: existing.expiresAt || null,
        product: {
          id: String(prod._id),
          name: prod.name,
          category: prod.category || '',
          kcal100: prod.kcal100 ?? null,
          p100: prod.p100 ?? null,
          f100: prod.f100 ?? null,
          c100: prod.c100 ?? null
        }
      });
    }

    // nowa pozycja
    const created = await FridgeItem.create({
      userId: req.user.id,
      productId: body.productId,
      grams: body.grams,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
    });

    return res.status(201).json({
      id: String(created._id),
      productId: String(created.productId),
      grams: created.grams,
      expiresAt: created.expiresAt || null,
      product: {
        id: String(prod._id),
        name: prod.name,
        category: prod.category || '',
        kcal100: prod.kcal100 ?? null,
        p100: prod.p100 ?? null,
        f100: prod.f100 ?? null,
        c100: prod.c100 ?? null
      }
    });
  } catch (e) {
    if (e?.name === 'ZodError') {
      const i = e.errors?.[0];
      return res.status(400).json({ message: i?.message || 'Błędne dane' });
    }
    console.error('POST /fridge error', e);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});




// PATCH /api/fridge/:id  { grams?, expiresAt? }  (grams:0 => usuń)
router.patch('/:id', auth, async (req, res) => {
  try {
    const payload = z.object({
      grams: gramsNonNeg.optional(),
      expiresAt: dateStrOpt            // YYYY-MM-DD | null | undefined
    })
    // musi przyjść choć jedno pole
    .refine(v => v.grams !== undefined || 'expiresAt' in v, { message: 'Podaj grams lub expiresAt' })
    .parse(req.body || {});

    const it = await FridgeItem.findOne({ _id: req.params.id, userId: req.user.id });
    if (!it) return res.status(404).json({ message: 'Pozycja nie istnieje' });

    // 0 gramów = kasujemy pozycję
    if (payload.grams === 0) {
      await it.deleteOne();
      return res.json({ deleted: true });
    }

    // aktualizacje pól
    if (payload.grams !== undefined) it.grams = payload.grams;
    if ('expiresAt' in payload) it.expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;

    await it.save();

    // lekkie dołączenie produktu
    const prod = await Product.findById(it.productId)
      .select('name category kcal100 p100 f100 c100')
      .lean();

    return res.json({
      id: String(it._id),
      productId: String(it.productId),
      grams: it.grams,
      expiresAt: it.expiresAt || null,
      product: prod ? {
        id: String(prod._id),
        name: prod.name,
        category: prod.category || '',
        kcal100: prod.kcal100 ?? null,
        p100: prod.p100 ?? null,
        f100: prod.f100 ?? null,
        c100: prod.c100 ?? null
      } : null
    });
  } catch (e) {
    if (e?.name === 'ZodError') {
      const i = e.errors?.[0];
      return res.status(400).json({ message: i?.message || 'Błędne dane' });
    }
    console.error('PATCH /fridge/:id error', e);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});


// DELETE /api/fridge/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const del = await FridgeItem.findOneAndDelete({ _id: req.params.id, userId: req.user.id }).lean();
    if (!del) return res.status(404).json({ message: 'Pozycja nie istnieje' });
    res.status(204).end();
  } catch (e) {
    console.error('DELETE /fridge/:id error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
