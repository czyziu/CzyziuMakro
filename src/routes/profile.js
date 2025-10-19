// src/routes/profile.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Profile = require('../models/Profile');
const UserMacro = require('../models/UserMacro'); // + makra
const { computeEER, beginnerSplitKcal, advancedSplit } = require('../eer'); // + kalkulator

// GET /api/profile/status
router.get('/status', auth, async (req, res) => {
  try {
    const doc = await Profile.findOne({ userId: req.user.id }).lean();
    if (!doc) return res.json({ completed: false });

    const { age, weight, height, activity, sex, level, goal } = doc;
    const completed =
      Number.isFinite(age) &&
      Number.isFinite(weight) &&
      Number.isFinite(height) &&
      [1,2,3,4,5].includes(activity) &&
      ['F','M'].includes(sex) &&
      ['basic','advanced'].includes(level) &&
      ['loss','maintain','gain'].includes(goal);

    return res.json({ completed, profile: { age, weight, height, activity, sex, level, goal } });
  } catch (err) {
    console.error('Profile status error:', err);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// POST /api/profile/onboarding
router.post('/onboarding', auth, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Brak użytkownika (auth)' });
    }

    // --- Wejście + normalizacja
    const {
      age, weight, height, activity, sex, level, goal
    } = req.body || {};

    const ageNum      = Number.parseInt(age, 10);
    const weightNum   = Number(String(weight).replace(',', '.'));
    const heightNum   = Number(String(height).replace(',', '.'));
    const activityNum = Number.parseInt(activity, 10);
    const sexStr      = typeof sex === 'string' ? sex.trim().toUpperCase() : '';
    const levelStr    = typeof level === 'string' ? level.trim().toLowerCase() : '';
    const goalStr     = typeof goal === 'string' ? goal.trim().toLowerCase() : '';

    // --- Walidacje (jak miałeś)
    if (!Number.isFinite(ageNum)    || ageNum < 18  || ageNum > 120)  return res.status(400).json({ message: 'Wiek 18–120.' });
    if (!Number.isFinite(weightNum) || weightNum < 20 || weightNum > 400) return res.status(400).json({ message: 'Waga 20–400 kg.' });
    if (!Number.isFinite(heightNum) || heightNum < 100|| heightNum > 250)  return res.status(400).json({ message: 'Wzrost 100–250 cm.' });
    if (![1,2,3,4,5].includes(activityNum))                               return res.status(400).json({ message: 'Aktywność: 1–5.' });
    if (!['F','M'].includes(sexStr))                                      return res.status(400).json({ message: 'Płeć: F lub M.' });
    if (!['basic','advanced'].includes(levelStr))                         return res.status(400).json({ message: 'Poziom: basic/advanced.' });
    if (!['loss','maintain','gain'].includes(goalStr))                    return res.status(400).json({ message: 'Cel: loss/maintain/gain.' });

    // --- Zapis/aktualizacja profilu
    const payload = {
      userId: req.user.id,
      age: ageNum,
      weight: weightNum,
      height: heightNum,
      activity: activityNum,
      sex: sexStr,               // 'F' | 'M'
      level: levelStr,           // 'basic' | 'advanced'
      goal: goalStr,             // 'loss' | 'maintain' | 'gain'
      completed: true,
    };

    const profile = await Profile.findOneAndUpdate(
      { userId: req.user.id },
      { $set: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    // --- Liczenie EER + makr (w tym samym request)
    const sexVerbose  = sexStr === 'M' ? 'male' : 'female';            // kalkulator wymaga 'male'/'female' :contentReference[oaicite:1]{index=1}
    const levelMacro  = levelStr === 'basic' ? 'beginner' : 'advanced';// i 'beginner'/'advanced'  :contentReference[oaicite:2]{index=2}

    const { eerKcal, pa } = computeEER({
      sex: sexVerbose,
      age: ageNum,
      heightCm: heightNum,
      weightKg: weightNum,
      activity: activityNum
    }); // EER/PA z Twojego pliku  :contentReference[oaicite:3]{index=3}

    // opcjonalna korekta kcal wg celu
    const goalAdj = goalStr === 'loss' ? -0.15 : goalStr === 'gain' ? +0.10 : 0;
    const targetKcal = Math.round(eerKcal * (1 + goalAdj));

    const macros = (levelMacro === 'beginner')
      ? beginnerSplitKcal(targetKcal)
      : advancedSplit(targetKcal, weightNum);        // splity z eer.js  :contentReference[oaicite:4]{index=4}

    // --- Zapis makr (historia; 1 rekord per wyliczenie)
    const macro = await UserMacro.create({
      userId: req.user.id,
      kcal: macros.kcal,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
      protein_g: macros.protein_g,
      method: levelMacro,  // 'beginner' | 'advanced'
      pa,
      goal: goalStr
    }); // model makr  :contentReference[oaicite:5]{index=5}

    // // WARIANT: JEDEN dokument per user (odkomentuj zamiast create powyżej)
    // const macro = await UserMacro.findOneAndUpdate(
    //   { userId: req.user.id },
    //   {
    //     $set: {
    //       kcal: macros.kcal,
    //       carbs_g: macros.carbs_g,
    //       fat_g: macros.fat_g,
    //       protein_g: macros.protein_g,
    //       method: levelMacro,
    //       pa,
    //       goal: goalStr
    //     }
    //   },
    //   { upsert: true, new: true }
    // );

    return res.status(200).json({
      ok: true,
      profile: {
        age: profile.age,
        weight: profile.weight,
        height: profile.height,
        activity: profile.activity,
        sex: profile.sex,
        level: profile.level,
        goal: profile.goal,
      },
      macro
    });
  } catch (e) {
    console.error('PROFILE ONBOARDING ERROR:', e);
    if (e.name === 'ValidationError') return res.status(400).json({ message: e.message });
    if (e.code === 11000) {
      try {
        const saved = await Profile.findOneAndUpdate(
          { userId: req.user.id },
          { $set: { ...req.body, completed: true } },
          { new: true, runValidators: true }
        ).lean();
        return res.status(200).json({ ok: true, profile: saved });
      } catch (e2) {
        console.error('ONBOARDING DUPLICATE ERROR:', e2);
        return res.status(500).json({ message: 'Błąd serwera (dup)' });
      }
    }
    return res.status(500).json({ message: 'Błąd serwera (onboarding)' });
  }
});

// GET /api/profile/macro/latest — ostatnio zapisane makro danego usera
router.get('/macro/latest', auth, async (req, res) => {
  try {
    const macro = await UserMacro
      .findOne({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    if (!macro) {
      return res.status(404).json({ message: 'Użytkownik nie ma jeszcze zapisanych makr.' });
    }

    return res.json({
      ok: true,
      macro: {
        kcal: macro.kcal,
        protein_g: macro.protein_g,
        fat_g: macro.fat_g,
        carbs_g: macro.carbs_g,
        method: macro.method,
        pa: macro.pa,
        goal: macro.goal,
        createdAt: macro.createdAt
      }
    });
  } catch (e) {
    console.error('PROFILE /macro/latest error:', e);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});


module.exports = router;
