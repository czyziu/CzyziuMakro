// src/app.js
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const productsRoutes = require('./routes/products');
const fridgeRoutes = require('./routes/fridge');

const app = express();

// Middlewares
app.use(helmet());
app.use(express.json());

// --- NORMALIZACJA fullName -> username (rejestracja) ---
app.use((req, res, next) => {
  const isRegister =
    req.method === 'POST' &&
    (req.originalUrl === '/api/auth/register' ||
     req.originalUrl.startsWith('/api/auth/register'));

  if (!isRegister) return next();

  const body = req.body || {};
  const raw = (typeof body.username === 'string' && body.username.trim())
    ? body.username
    : (typeof body.fullName === 'string' ? body.fullName : '');

  if (!raw) return res.status(400).json({ message: 'Podaj imię i nazwisko.' });

  let u = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  u = u.replace(/[^a-zA-Z0-9_.\- ]+/g, '');
  u = u.trim().replace(/\s+/g, '_').toLowerCase();

  if (u.length < 3) {
    return res.status(400).json({ message: 'Login po przetworzeniu musi mieć min. 3 znaki.' });
  }

  req.body.username = u;
  next();
});

app.use(morgan(process.env.NODE_ENV === 'test' ? 'tiny' : 'dev'));

// Static
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/fridge', fridgeRoutes);

// 404 dla nieistniejących endpointów API + fallback na index.html
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
