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

    const { age, weight, activity, sex, level, completed } = doc;
    return res.json({ completed: !!completed, profile: { age, weight, activity, sex, level } });
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

    console.log('[onboarding] user:', req.user);
    console.log('[onboarding] body:', req.body);

    const { age, weight, activity, sex, level } = req.body || {};
    const ageNum = Number(age);
    const weightNum = Number(weight);
    const activityNum = Number(activity);

    if (!Number.isFinite(ageNum) || ageNum < 18 || ageNum > 120 || !Number.isInteger(ageNum)) {
      return res.status(400).json({ message: 'Wiek musi być liczbą całkowitą 18–120.' });
    }
    if (!Number.isFinite(weightNum) || weightNum < 20 || weightNum > 400) {
      return res.status(400).json({ message: 'Waga musi być w zakresie 20–400 kg.' });
    }
    if (![1, 2, 3, 4, 5].includes(activityNum)) {
      return res.status(400).json({ message: 'Aktywność: 1–5.' });
    }
    if (!['F', 'M'].includes(sex)) {
      return res.status(400).json({ message: 'Płeć: F lub M.' });
    }
    if (!['basic', 'advanced'].includes(level)) {
      return res.status(400).json({ message: 'Poziom: basic/advanced.' });
    }

    const payload = {
      userId: req.user.id,
      age: ageNum,
      weight: weightNum,
      activity: activityNum,
      sex,
      level,
      completed: true,
    };

    await Profile.findOneAndUpdate(
      { userId: req.user.id },
      { $set: payload },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('PROFILE ONBOARDING ERROR:', e);

    if (e.name === 'ValidationError') {
      return res.status(400).json({ message: e.message });
    }

    if (e.code === 11000) {
      try {
        await Profile.updateOne(
          { userId: req.user.id },
          { $set: { ...req.body, completed: true } },
          { runValidators: true }
        );
        return res.status(200).json({ ok: true });
      } catch (e2) {
        console.error('ONBOARDING DUPLICATE ERROR:', e2);
        return res.status(500).json({ message: 'Błąd serwera (dup)' });
      }
    }

    return res.status(500).json({ message: 'Błąd serwera (onboarding)' });
  }
});

module.exports = router;
