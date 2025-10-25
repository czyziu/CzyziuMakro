// CommonJS
const express = require('express');
const router = express.Router();
const { z } = require('zod');

// DOPASUJ ŚCIEŻKI do swojego projektu:
const { Product, CATEGORIES } = require('../models/Product');   // np. ../models/Product
const auth = require('../middleware/auth');                     // np. ../auth

// ---- Walidatory Zod ----
// puste stringi -> undefined, liczby >= 0
const number100 = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
  z.number().min(0).optional()
);
// zamiast z.enum(CATEGORIES) (potrafi rzucać błędy typowania w JS/VSCode)
const categorySchema = z
  .string()
  .refine((v) => CATEGORIES.includes(v), { message: 'Nieprawidłowa kategoria' });

const createSchema = z.object({
  name: z.string().min(1).max(200),
  category: categorySchema,
  kcal100: number100,
  p100: number100,
  f100: number100,
  c100: number100,
});

const updateSchema = createSchema.partial();

// GET /api/products?page=1&pageSize=10&q=tekst
router.get('/', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
    const q = String(req.query.q || '').trim();
    const scope = String(req.query.scope || 'all').toLowerCase(); // 'all' | 'mine'

    const base = scope === 'mine' ? { userId: req.user.id } : {}; // ← ALL by default
    const where = q
     ? {
         $and: [
           base,
           {
             $or: [
               { name: { $regex: q, $options: 'i' } },
              { category: { $regex: q, $options: 'i' } },
             ],
           },
         ],
       }
     : base;

    const [items, total] = await Promise.all([
      Product.find(where).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Product.countDocuments(where),
    ]);

    res.json({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (e) {
    console.error('GET /products error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// POST /api/products
router.post('/', auth, async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issue = parsed.error.issues?.[0];
      return res.status(400).json({ message: issue?.message || 'Błędne dane', path: issue?.path || [] });
    }
    const p = parsed.data;

    const doc = await Product.create({
      userId: req.user.id,
      name: p.name.trim(),
      category: p.category,
      kcal100: p.kcal100 ?? null,
      p100: p.p100 ?? null,
      f100: p.f100 ?? null,
      c100: p.c100 ?? null,
    });

    res.status(201).json(doc);
  } catch (e) {
    console.error('POST /products error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// GET /api/products/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await Product.findOne({ _id: req.params.id, userId: req.user.id }).lean();
    if (!doc) return res.status(404).json({ message: 'Nie znaleziono' });
    res.json(doc);
  } catch (e) {
    console.error('GET /products/:id error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// PATCH /api/products/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const parsed = updateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issue = parsed.error.issues?.[0];
      return res.status(400).json({ message: issue?.message || 'Błędne dane', path: issue?.path || [] });
    }
    const patch = parsed.data;
    if (patch.name) patch.name = patch.name.trim();

    const updated = await Product.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) return res.status(404).json({ message: 'Nie znaleziono' });
    res.json(updated);
  } catch (e) {
    console.error('PATCH /products/:id error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const del = await Product.findOneAndDelete({ _id: req.params.id, userId: req.user.id }).lean();
    if (!del) return res.status(404).json({ message: 'Nie znaleziono' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /products/:id error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
