// src/routes/profile.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Profile = require('../models/Profile');

// GET /api/profile/status
router.get('/status', auth, async (req, res) => {
  try {
    const doc = await Profile.findOne({ userId: req.user.id }).lean();
    if (!doc) return res.json({ completed: false });

    const { age, weight, height, activity, sex, level, goal } = doc;

    // completed gdy wszystkie kluczowe pola są
    const completed =
      Number.isFinite(age) &&
      Number.isFinite(weight) &&
      Number.isFinite(height) &&
      [1,2,3,4,5].includes(activity) &&
      ['F','M'].includes(sex) &&
      ['basic','advanced'].includes(level) &&
      ['loss','maintain','gain'].includes(goal);

    return res.json({
      completed,
      profile: { age, weight, height, activity, sex, level, goal }
    });
  } catch (err) {
    console.error('Profile status error:', err);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// POST /api/profile/onboarding
router.post('/onboarding', auth, express.json(), async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Brak użytkownika (auth)' });
    }

    // Wejście
    const {
      age,
      weight,
      height,   // 🆕
      activity,
      sex,
      level,
      goal,     // 🆕
    } = req.body || {};

    // Normalizacja / parsowanie
    const ageNum      = Number.parseInt(age, 10);
    const weightNum   = Number(weight);
    const heightNum   = Number(height);              // 🆕
    const activityNum = Number.parseInt(activity, 10);
    const sexStr      = typeof sex === 'string' ? sex.trim().toUpperCase() : '';
    const levelStr    = typeof level === 'string' ? level.trim().toLowerCase() : '';
    const goalStr     = typeof goal === 'string' ? goal.trim().toLowerCase() : '';

    // Walidacje
    if (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 120) {
      return res.status(400).json({ message: 'Wiek musi być liczbą całkowitą 18–120.' });
    }
    if (!Number.isFinite(weightNum) || weightNum < 20 || weightNum > 400) {
      return res.status(400).json({ message: 'Waga musi być w zakresie 20–400 kg.' });
    }
    if (!Number.isFinite(heightNum) || heightNum < 100 || heightNum > 250) {
      return res.status(400).json({ message: 'Wzrost musi być w zakresie 100–250 cm.' });
    }
    if (![1, 2, 3, 4, 5].includes(activityNum)) {
      return res.status(400).json({ message: 'Aktywność: 1–5.' });
    }
    if (!['F', 'M'].includes(sexStr)) {
      return res.status(400).json({ message: 'Płeć: F lub M.' });
    }
    if (!['basic', 'advanced'].includes(levelStr)) {
      return res.status(400).json({ message: 'Poziom: basic/advanced.' });
    }
    if (!['loss', 'maintain', 'gain'].includes(goalStr)) {
      return res.status(400).json({ message: 'Cel: loss / maintain / gain.' });
    }

    // Payload do zapisu
    const payload = {
      userId: req.user.id,
      age: ageNum,
      weight: weightNum,
      height: heightNum,     // 🆕
      activity: activityNum,
      sex: sexStr,
      level: levelStr,
      goal: goalStr,         // 🆕
      completed: true,
    };

    // Zapis/aktualizacja
    const saved = await Profile.findOneAndUpdate(
      { userId: req.user.id },
      { $set: payload },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({
      ok: true,
      profile: {
        age: saved.age,
        weight: saved.weight,
        height: saved.height,     // 🆕
        activity: saved.activity,
        sex: saved.sex,
        level: saved.level,
        goal: saved.goal,         // 🆕
      },
    });
  } catch (e) {
    console.error('PROFILE ONBOARDING ERROR:', e);

    if (e.name === 'ValidationError') {
      return res.status(400).json({ message: e.message });
    }

    if (e.code === 11000) {
      try {
        const saved = await Profile.findOneAndUpdate(
          { userId: req.user.id },
          { $set: { ...req.body, completed: true } },
          { new: true, runValidators: true }
        ).lean();
        return res.status(200).json({
          ok: true,
          profile: {
            age: saved.age,
            weight: saved.weight,
            height: saved.height,   // 🆕
            activity: saved.activity,
            sex: saved.sex,
            level: saved.level,
            goal: saved.goal,       // 🆕
          },
        });
      } catch (e2) {
        console.error('ONBOARDING DUPLICATE ERROR:', e2);
        return res.status(500).json({ message: 'Błąd serwera (dup)' });
      }
    }

    return res.status(500).json({ message: 'Błąd serwera (onboarding)' });
  }
});

module.exports = router;
