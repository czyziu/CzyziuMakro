const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./config/db');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();

// DB
connectDB();

// Middlewares
app.use(helmet());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'test' ? 'tiny' : 'dev'));

// Static: serwuj stronę główną i pliki publiczne z /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

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
