// CommonJS — src/routes/meals.js
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const auth = require('../middleware/auth'); // jak w products.js
const { Meal, MEAL_CATEGORIES } = require('../models/Meal');
const { Product } = require('../models/Product');

// ---- Walidatory Zod ----
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Nieprawidłowe ID');
const posInt  = z.preprocess(v => v === '' || v == null ? undefined : Number(v), z.number().int().min(1));
const posNum  = z.preprocess(v => v === '' || v == null ? undefined : Number(v), z.number().min(1));
const nonNeg  = z.preprocess(v => v === '' || v == null ? undefined : Number(v), z.number().min(0));

const mealCategory = z.string().refine(v => MEAL_CATEGORIES.includes(v), 'Nieprawidłowa kategoria');

const ingredientSchema = z.object({
  productId: objectId,
  grams: posNum,
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  category: mealCategory,
  portions: posInt.optional(),         // opcjonalne
  postWeight: nonNeg.optional(),       // opcjonalne
  recipe: z.string().max(10000).optional().default(''),
  isPublic: z.boolean().optional().default(false),
  ingredients: z.array(ingredientSchema).min(2, 'Dodaj przynajmniej dwa składniki'),
});

const updateSchema = createSchema.partial();

// ---- Helper: spłaszczenie populated produktów do { productId, grams, product } ----
function shapeMeal(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    name: o.name,
    category: o.category,
    portions: o.portions || 1,
    postWeight: o.postWeight || 0,
    recipe: o.recipe || '',
    isPublic: !!o.isPublic,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    ingredients: (o.ingredients || []).map(it => {
      const prod = it.productId && typeof it.productId === 'object' && it.productId._id
        ? it.productId
        : null;
      return {
        productId: String(prod?._id || it.productId),
        grams: it.grams,
        product: prod ? {
          id: String(prod._id),
          name: prod.name,
          category: prod.category,
          kcal100: prod.kcal100 ?? null,
          p100:    prod.p100 ?? null,
          f100:    prod.f100 ?? null,
          c100:    prod.c100 ?? null,
        } : undefined,
      };
    }),
  };
}

// GET /api/meals?page=1&pageSize=10&q=tekst&scope=mine|all
// Domyślnie zwracamy WYŁĄCZNIE dania użytkownika (żeby nie pojawiały się przyciski Edytuj/Usuń dla cudzych).
router.get('/', auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
    const q = String(req.query.q || '').trim();
    const scope = String(req.query.scope || 'mine').toLowerCase(); // 'mine' | 'all'

    const base = scope === 'all'
      ? { $or: [{ userId: req.user.id }, { isPublic: true }] }
      : { userId: req.user.id };

    const where = q
      ? { $and: [ base, { $or: [ { name: { $regex: q, $options: 'i' } }, { category: { $regex: q, $options: 'i' } } ] } ] }
      : base;

    const [items, total] = await Promise.all([
      Meal.find(where)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate({ path: 'ingredients.productId', select: 'name category kcal100 p100 f100 c100' }),
      Meal.countDocuments(where),
    ]);

    res.json({
      items: items.map(shapeMeal),
      page, pageSize, total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    console.error('GET /meals error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// POST /api/meals
router.post('/', auth, async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issue = parsed.error.issues?.[0];
      return res.status(400).json({ message: issue?.message || 'Błędne dane', path: issue?.path || [] });
    }
    const p = parsed.data;

    // Walidacja istnienia produktów (mogą być globalne — bez wymogu userId)
    const prodIds = [...new Set(p.ingredients.map(i => i.productId))];
    const exists = await Product.countDocuments({ _id: { $in: prodIds } });
    if (exists !== prodIds.length) {
      return res.status(400).json({ message: 'Niektóre produkty nie istnieją' });
    }

    const doc = await Meal.create({
      userId: req.user.id,
      name: p.name.trim(),
      category: p.category,
      portions: p.portions ?? 1,
      postWeight: p.postWeight ?? 0,
      recipe: p.recipe ?? '',
      isPublic: !!p.isPublic,
      ingredients: p.ingredients,
    });

    const populated = await Meal.findById(doc._id)
      .populate({ path: 'ingredients.productId', select: 'name category kcal100 p100 f100 c100' });

    res.status(201).json(shapeMeal(populated));
  } catch (e) {
    console.error('POST /meals error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// GET /api/meals/:id  (widzisz swoje lub publiczne)
router.get('/:id', auth, async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Meal.findOne({
      _id: id,
      $or: [{ userId: req.user.id }, { isPublic: true }],
    }).populate({ path: 'ingredients.productId', select: 'name category kcal100 p100 f100 c100' });

    if (!doc) return res.status(404).json({ message: 'Nie znaleziono' });
    res.json(shapeMeal(doc));
  } catch (e) {
    console.error('GET /meals/:id error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// PATCH /api/meals/:id (edycja tylko swoich dań)
router.patch('/:id', auth, async (req, res) => {
  try {
    const parsed = updateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const issue = parsed.error.issues?.[0];
      return res.status(400).json({ message: issue?.message || 'Błędne dane', path: issue?.path || [] });
    }
    const patch = parsed.data;
    if (patch.name) patch.name = patch.name.trim();

    if (patch.ingredients) {
      if (patch.ingredients.length < 2) {
        return res.status(400).json({ message: 'Dodaj przynajmniej dwa składniki' });
      }
      const prodIds = [...new Set(patch.ingredients.map(i => i.productId))];
      const exists = await Product.countDocuments({ _id: { $in: prodIds } });
      if (exists !== prodIds.length) {
        return res.status(400).json({ message: 'Niektóre produkty nie istnieją' });
      }
    }

    const updated = await Meal.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: patch },
      { new: true, runValidators: true }
    ).populate({ path: 'ingredients.productId', select: 'name category kcal100 p100 f100 c100' });

    if (!updated) return res.status(404).json({ message: 'Nie znaleziono' });
    res.json(shapeMeal(updated));
  } catch (e) {
    console.error('PATCH /meals/:id error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// DELETE /api/meals/:id (usuniesz tylko swoje)
router.delete('/:id', auth, async (req, res) => {
  try {
    const del = await Meal.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!del) return res.status(404).json({ message: 'Nie znaleziono' });
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /meals/:id error', e);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
