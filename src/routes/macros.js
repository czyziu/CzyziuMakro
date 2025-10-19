// /backend/routes/macros.js
const express = require('express');
const auth = require('../middleware/auth');
const UserMacro = require('../models/UserMacro');
const { computeEER, beginnerSplitKcal, advancedSplit } = require('../eer');

const router = express.Router();

/** Normalizacje z payloadu frontu */
function mapSex(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s === 'm' || s === 'male') return 'male';
  if (s === 'f' || s === 'female') return 'female';
  return null;
}
function mapLevel(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s === 'basic' || s === 'beginner') return 'beginner';
  if (s === 'advanced') return 'advanced';
  return null;
}
function toNum(x) {
  if (x === null || x === undefined) return NaN;
  // zamiana ewentualnego przecinka na kropkę
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * POST /api/macros — policz i zapisz makra
 * Body:
 *  - sex: 'F'|'M' | 'female'|'male'
 *  - age, heightCm, weightKg: number
 *  - activity: 1..5
 *  - level: 'basic'|'beginner'|'advanced'
 *  - goal: 'loss'|'maintain'|'gain' (opcjonalnie)
 */
router.post('/', auth, async (req, res) => {
  try {
    const uid = req.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // normalizacja wejścia
    const sex = mapSex(req.body.sex);
    const level = mapLevel(req.body.level);
    const age = toNum(req.body.age);
    const heightCm = toNum(req.body.heightCm);
    const weightKg = toNum(req.body.weightKg);
    const activity = toNum(req.body.activity);
    const goal = (req.body.goal === 'loss' || req.body.goal === 'gain') ? req.body.goal : 'maintain';

    // walidacje
    if (!(sex === 'female' || sex === 'male')) throw new Error('Bad sex');
    if (!Number.isFinite(age) || age < 10 || age > 120) throw new Error('Bad age');
    if (!Number.isFinite(heightCm) || heightCm < 80 || heightCm > 250) throw new Error('Bad heightCm');
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) throw new Error('Bad weightKg');
    if (![1, 2, 3, 4, 5].includes(activity)) throw new Error('Bad activity');
    if (!(level === 'beginner' || level === 'advanced')) throw new Error('Bad level');

    // policz EER
    const { eerKcal, pa } = computeEER({
      sex,
      age,
      heightCm,
      weightKg,
      activity
    });

    // korekta kcal wg celu (opcjonalnie)
    const goalAdj = goal === 'loss' ? -0.15 : goal === 'gain' ? +0.10 : 0;
    const targetKcal = Math.round(eerKcal * (1 + goalAdj));

    // podział makro wg poziomu
    const macros = (level === 'beginner')
      ? beginnerSplitKcal(targetKcal)
      : advancedSplit(targetKcal, weightKg);

    // Zapis historii (1 rekord per wyliczenie)
    const doc = await UserMacro.create({
      userId: uid,
      kcal: macros.kcal,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
      protein_g: macros.protein_g,
      method: level, // 'beginner' | 'advanced'
      pa,
      goal
    });

    return res.json({ ok: true, id: doc._id, eerKcal, pa, macros });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Bad request' });
  }
});

/**
 * GET /api/macros/latest — ostatni zapis makr danego usera
 */
router.get('/latest', auth, async (req, res) => {
  try {
    const uid = req.user?.id;
    if (!uid) return res.status(401).json({ ok:false, error: 'Unauthorized' });

    const last = await UserMacro.findOne({ userId: uid }).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, data: last || null });
  } catch (err) {
    return res.status(400).json({ ok:false, error: err.message });
  }
});

module.exports = router;
