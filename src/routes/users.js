const express = require('express');
const User = require('../models/User');
const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const users = await User.find({}, { password: 0 }).sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
