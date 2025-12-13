// server.js
require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const app = require('./app');

const PORT = Number(process.env.PORT) || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/czyziumakro';

let server;

/* ───────────────── MAIL: konfiguracja nodemailer (Gmail) ───────────────── */

let transporter = null;

if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
  console.warn('⚠️ MAIL_USER lub MAIL_PASS nie jest ustawione. Formularz kontaktowy nie wyśle maila.');
} else {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS, // hasło aplikacji Google, NIE zwykłe hasło
    },
  });
}

/**
 * Endpoint formularza kontaktowego:
 * POST /api/contact
 * body: { name, email, subject, message, consent }
 */
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message, consent } = req.body || {};

  if (!name || !email || !subject || !message || !consent) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  if (!transporter) {
    return res.status(500).json({ ok: false, error: 'MAIL_NOT_CONFIGURED' });
  }

  const mailOptions = {
    from: `"CzyziuMakro — formularz" <${process.env.MAIL_USER}>`,
    to: process.env.MAIL_TO || process.env.MAIL_USER, // gdzie ma przychodzić
    replyTo: email,
    subject: `[CzyziuMakro] ${subject}`,
    text: `
Nowa wiadomość z formularza kontaktowego:

Imię i nazwisko: ${name}
E-mail: ${email}

Treść wiadomości:
${message}

Zgoda na przetwarzanie danych: ${consent ? 'TAK' : 'NIE'}
    `.trim(),
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ Błąd przy wysyłce maila z formularza:', err);
    return res.status(500).json({ ok: false, error: 'MAIL_ERROR' });
  }
});

/* ───────────────── Start serwera + MongoDB ───────────────── */

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`✅ MongoDB connected: ${MONGO_URI}`);

    server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`🚀 CzyziuMakro API listening on port ${PORT}`);
    });

    server.on('error', (err) => {
      console.error('❌ HTTP server error:', err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
})();

/* ───────────────── Graceful shutdown ───────────────── */

const shutdown = async (signal) => {
  try {
    console.log(`\n🛑 Received ${signal}. Closing server...`);
    if (server) {
      await new Promise((res) => server.close(res));
      console.log('🧰 HTTP server closed.');
    }
    await mongoose.connection.close();
    console.log('🗄️ MongoDB connection closed.');
  } catch (e) {
    console.error('⚠️ Error during shutdown:', e.message);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  shutdown('uncaughtException');
});