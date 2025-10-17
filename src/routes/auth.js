const router = require('express').Router();
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const validate = require('../middleware/validate');

const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2).max(100)
  })
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8)
  })
});

router.post('/register', validate(registerSchema), async (req, res) => {
  const { email, password, name } = req.validated.body;

  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const user = new User({ email, name });
  await user.setPassword(password);
  await user.save();

  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

  res.status(201).json({
    user: { id: user._id, email: user.email, name: user.name },
    token
  });
});

router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.validated.body;

  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await user.validatePassword(password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });

  res.json({
    user: { id: user._id, email: user.email, name: user.name },
    token
  });
});

module.exports = router;
