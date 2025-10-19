const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./config/db');

const profileRoutes = require('./routes/profile');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const macrosRoutes = require('./routes/macros.js'); // ← DODAJ NA GÓRZE


const app = express();

// DB
connectDB();

// Middlewares
app.use(helmet());
app.use(express.json());
// --- NORMALIZACJA fullName -> username (rejestracja) ---
app.use((req, res, next) => {
  // działa tylko dla POST /api/auth/register
  const isRegister =
    req.method === 'POST' &&
    (req.originalUrl === '/api/auth/register' || req.originalUrl.startsWith('/api/auth/register'));

  if (!isRegister) return next();

  const body = req.body || {};
  const raw = typeof body.username === 'string' && body.username.trim()
    ? body.username
    : (typeof body.fullName === 'string' ? body.fullName : '');

  if (!raw) {
    // brak i fullName, i username -> czytelny błąd
    return res.status(400).json({ message: 'Podaj imię i nazwisko.' });
  }

  // 1) usuwamy polskie znaki ⇒ Żółć -> Zolc
  let u = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // 2) dopuszczamy litery/cyfry/kropka/podkreślnik/myślnik/spacje
  u = u.replace(/[^a-zA-Z0-9_.\- ]+/g, '');
  // 3) spacje -> podkreślniki
  u = u.trim().replace(/\s+/g, '_').toLowerCase();

  if (u.length < 3) {
    return res.status(400).json({ message: 'Login po przetworzeniu musi mieć min. 3 znaki.' });
  }

  // podstaw gotowy username dla walidatora Zod
  req.body.username = u;
  next();
});
app.use(morgan(process.env.NODE_ENV === 'test' ? 'tiny' : 'dev'));

// Static: serwuj stronę główną i pliki publiczne z /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/macros', macrosRoutes); // ← DODAJ TĘ LINIĘ



// 404 (dla nieistniejących endpointów API; pliki statyczne obsługuje middleware powyżej)
app.use((req, res) => {
  // Jeśli to wygląda na próbę wejścia na API — zwróć JSON.
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  // W innym wypadku spróbuj odesłać index.html (SPA-like fallback)
  return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
