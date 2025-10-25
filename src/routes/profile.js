// src/routes/profile.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const Profile = require('../models/Profile');
const User = require('../models/User');
const UserMacro = require('../models/UserMacro');

const { computeEER, beginnerSplitKcal, advancedSplit } = require('../eer');

// ---------------------------------------------------------------------------
// GET /api/profile/status
// Zwraca, czy profil jest uzupełniony i podstawowe parametry profilu.
// ---------------------------------------------------------------------------
router.get('/status', auth, async (req, res) => {
  try {
    const doc = await Profile.findOne({ userId: req.user.id }).lean();
    if (!doc) {
      return res.json({ completed: false });
    }
    const { age, weight, height, activity, sex, level, goal, completed } = doc;
    return res.json({
      completed: !!completed,
      profile: { age, weight, height, activity, sex, level, goal }
    });
  } catch (e) {
    console.error('PROFILE GET /status error:', e);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile/onboarding
// Zapisuje/aktualizuje profil użytkownika + zapisuje płeć w User,
// liczy EER i makra, zapisuje ostatnie makro do historii.
// ---------------------------------------------------------------------------
router.post('/onboarding', auth, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Brak użytkownika (auth)' });
    }

    // --- Wejście + normalizacja
    const { age, weight, height, activity, sex, level, goal } = req.body || {};
    const ageNum      = Number.parseInt(age, 10);
    const weightNum   = Number(String(weight).replace(',', '.'));
    const heightNum   = Number(String(height).replace(',', '.'));
    const activityNum = Number.parseInt(activity, 10);
    const sexStr      = typeof sex === 'string' ? sex.trim().toUpperCase() : '';
    const levelStr    = typeof level === 'string' ? level.trim().toLowerCase() : '';
    const goalStr     = typeof goal === 'string' ? goal.trim().toLowerCase() : '';

    // --- Walidacje
    if (!Number.isFinite(ageNum)    || ageNum < 18  || ageNum > 120)  return res.status(400).json({ message: 'Wiek 18–120.' });
    if (!Number.isFinite(weightNum) || weightNum < 20 || weightNum > 400) return res.status(400).json({ message: 'Waga 20–400 kg.' });
    if (!Number.isFinite(heightNum) || heightNum < 100|| heightNum > 250)  return res.status(400).json({ message: 'Wzrost 100–250 cm.' });
    if (![1,2,3,4,5].includes(activityNum))                               return res.status(400).json({ message: 'Aktywność: 1–5.' });
    if (!['F','M'].includes(sexStr))                                      return res.status(400).json({ message: 'Płeć: F lub M.' });
    if (!['basic','advanced'].includes(levelStr))                         return res.status(400).json({ message: 'Poziom: basic/advanced.' });
    if (!['loss','maintain','gain'].includes(goalStr))                    return res.status(400).json({ message: 'Cel: loss/maintain/gain.' });

    // --- Zapis profilu (F/M)
    const payload = {
      userId: req.user.id,
      age: ageNum,
      weight: weightNum,
      height: heightNum,
      activity: activityNum,
      sex: sexStr,          // 'F' | 'M'
      level: levelStr,      // 'basic' | 'advanced'
      goal: goalStr,        // 'loss' | 'maintain' | 'gain'
      completed: true
    };

    const profile = await Profile.findOneAndUpdate(
      { userId: req.user.id },
      { $set: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    // --- Dodatkowo: zapis płci w User jako 'male'/'female'
    const userSex = sexStr === 'M' ? 'male' : 'female';
    await User.findByIdAndUpdate(req.user.id, { $set: { sex: userSex } }, { new: false });

    // --- Liczenie EER (AUTO: model wg level) i przeliczenie pod cel
    const sexVerbose = userSex; // 'male' | 'female'
    const useMifflin = (levelStr === 'basic'); // basic => Mifflin×AF, advanced => DRI/EER
    const { eerKcal, pa } = computeEER({
      sex: sexVerbose,
      age: ageNum,
      heightCm: heightNum,
      weightKg: weightNum,
      activity: activityNum,
      mode: useMifflin ? 'mifflin' : 'eer'
    });

    const goalAdj = goalStr === 'loss' ? -0.15 : goalStr === 'gain' ? +0.10 : 0;
    const targetKcal = Math.round(eerKcal * (1 + goalAdj));

    // --- Podział makro wg poziomu
    const method = (levelStr === 'basic') ? 'beginner' : 'advanced';
    const macros = (method === 'beginner')
      ? beginnerSplitKcal(targetKcal)
      : advancedSplit(targetKcal, weightNum);

    // --- Zapis makr do historii
    const macro = await UserMacro.create({
      userId: req.user.id,
      kcal: macros.kcal,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
      protein_g: macros.protein_g,
      method,
      pa,
      goal: goalStr
    });

    return res.status(200).json({
      ok: true,
      profile: {
        age: profile.age,
        weight: profile.weight,
        height: profile.height,
        activity: profile.activity,
        sex: profile.sex,
        level: profile.level,
        goal: profile.goal
      },
      macro
    });
  } catch (e) {
    console.error('PROFILE POST /onboarding error:', e);

    // Obsługa duplikatu (unique userId) — zaktualizuj istniejący dokument
    if (e && e.code === 11000) {
      try {
        const body = req.body || {};
        const sexStr = typeof body.sex === 'string' ? body.sex.trim().toUpperCase() : undefined;
        const patch = { ...body, completed: true };
        if (sexStr && ['F','M'].includes(sexStr)) patch.sex = sexStr;
        const saved = await Profile.findOneAndUpdate(
          { userId: req.user.id },
          { $set: patch },
          { new: true, runValidators: true }
        ).lean();
        return res.status(200).json({ ok: true, profile: saved });
      } catch (e2) {
        console.error('ONBOARDING DUPLICATE PATCH ERROR:', e2);
        return res.status(500).json({ message: 'Błąd serwera (dup)' });
      }
    }

    return res.status(500).json({ message: 'Błąd serwera (onboarding)' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/profile/macro/latest
// Zwraca ostatnie zapisane makro użytkownika.
// ---------------------------------------------------------------------------
router.get('/macro/latest', auth, async (req, res) => {
  try {
    const macro = await UserMacro
      .findOne({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    if (!macro) {
      return res.status(404).json({ message: 'Brak zapisanych makr.' });
    }

    return res.json({ ok: true, macro });
  } catch (e) {
    console.error('PROFILE GET /macro/latest error:', e);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile/macro
// Przelicza nowe makro na podstawie aktualnego profilu (lub body.kcal)
// i zapisuje do historii.
// Body opcjonalnie: { kcal?: number, method?: 'beginner'|'advanced' }
// ---------------------------------------------------------------------------
router.post('/macro', auth, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Brak użytkownika (auth).' });
    }

    const prof = await Profile.findOne({ userId: req.user.id }).lean();
    if (!prof) return res.status(400).json({ message: 'Brak profilu. Uzupełnij onboarding.' });

    // Ustal płeć "male|female" do computeEER z profilu (F/M)
    const sexVerbose = prof.sex === 'M' ? 'male' : 'female';

    // AUTO: model kalorii wg zapisanego level
    const useMifflin = (prof.level === 'basic'); // basic => Mifflin×AF, advanced => DRI/EER
    const { eerKcal, pa } = computeEER({
      sex: sexVerbose,
      age: prof.age,
      heightCm: prof.height,
      weightKg: prof.weight,
      activity: prof.activity,
      mode: useMifflin ? 'mifflin' : 'eer'
    });

    const method = (req.body && req.body.method)
      ? String(req.body.method)
      : (prof.level === 'basic' ? 'beginner' : 'advanced');

    let targetKcal;
    if (req.body && Number.isFinite(+req.body.kcal)) {
      targetKcal = Math.round(+req.body.kcal);
    } else {
      const goalAdj = prof.goal === 'loss' ? -0.15 : prof.goal === 'gain' ? +0.10 : 0;
      targetKcal = Math.round(eerKcal * (1 + goalAdj));
    }

    const macros = (method === 'beginner')
      ? beginnerSplitKcal(targetKcal)
      : advancedSplit(targetKcal, prof.weight);

    const macro = await UserMacro.create({
      userId: req.user.id,
      kcal: macros.kcal,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
      protein_g: macros.protein_g,
      method,
      pa,
      goal: prof.goal
    });

    return res.json({ ok: true, macro });
  } catch (e) {
    console.error('PROFILE POST /macro error:', e);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
