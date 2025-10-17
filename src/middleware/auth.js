// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs'); // jeśli wolisz natywne: require('bcrypt')
const { z } = require('zod');
const validateMW = require('../middleware/validate'); // może być default albo { validate }
const validate = validateMW.validate || validateMW;   // normalizacja importu
const User = require('../models/User');

const router = express.Router();

const registerSchema = z.object({
  username: z.string().trim().min(3, 'Nazwa min. 3 znaki'),
  email: z.string().trim().email('Nieprawidłowy email'),
  password: z.string().min(6, 'Hasło min. 6 znaków'),
});

router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const { username, email, password } = req.validated || req.body;

    // kolizje email/username
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) {
      return res.status(409).json({ message: 'Użytkownik z takim email/username już istnieje' });
    }

    // hash hasła
    const hashed = await bcrypt.hash(password, 10);

    // zapis
    const user = await User.create({ username, email, password: hashed });

    // bez hasła w odpowiedzi
    const safeUser = {
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
    };

    res.status(201).json({ message: 'Użytkownik zarejestrowany', user: safeUser });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'Email lub username jest już zajęty' });
    }
    console.error(err);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
