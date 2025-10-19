// src/routes/auth.js
const router = require('express').Router();
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const validateMW = require('../middleware/validate');
const validate = validateMW.validate || validateMW;

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Schematy
const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2).max(100),
  })
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
  })
});

// Rejestracja
router.post('/register', validate(registerSchema), async (req, res) => {
  try {
    const { email, password, name } = req.validated.body;
    const emailNorm = String(email).trim().toLowerCase();

    const exists = await User.findOne({ email: emailNorm });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const user = new User({ email: emailNorm, name });
    if (typeof user.setPassword === 'function') {
      await user.setPassword(password);
    } else {
      user.password = password; // fallback jeśli nie masz helpera
    }
    await user.save();

    const token = jwt.sign(
      { userId: String(user._id), sub: String(user._id), name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({ user: { id: user._id, email: user.email, name: user.name }, token });
  } catch (err) {
    console.error('REGISTER ERROR:', err);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

// Logowanie
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.validated.body;
    const emailNorm = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: emailNorm });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    let ok = false;
    if (typeof user.validatePassword === 'function') {
      ok = await user.validatePassword(password);
    } else {
      ok = user.password === password; // fallback
    }
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: String(user._id), sub: String(user._id), name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ user: { id: user._id, email: user.email, name: user.name }, token });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ message: 'Błąd serwera' });
  }
});

module.exports = router;
