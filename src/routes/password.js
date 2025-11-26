// src/routes/password.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const User = require('../models/User');

// ── Mailer ────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Skąd brać origin frontu
function getFrontOrigin() {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (process.env.NODE_ENV === 'production') {
    return 'https://twoja-domena.pl'; // podmień jak będziesz miał domenę
  }
  return 'http://localhost:4000';
}

// ============================================================================
// POST /api/password/forgot
// body: { email }
// ============================================================================
router.post('/forgot', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ message: 'Podaj adres e-mail.' });
    }

    const user = await User.findOne({ email }).exec();

    // Zawsze ten sam komunikat (nie zdradzamy czy konto istnieje)
    const genericMsg =
      'Jeśli konto istnieje, wysłaliśmy instrukcję resetu hasła.';

    if (!user) {
      return res.json({ ok: true, message: genericMsg });
    }

    // 1) Token + ważność 1h
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    user.resetPasswordToken = token;
    user.resetPasswordExpires = expires;
    await user.save();

    console.log('[FORGOT] token zapisany w bazie:', token);

    // 2) Link do STRONY USTAWIANIA NOWEGO HASŁA
    const origin = getFrontOrigin(); // np. http://localhost:4000
    const resetUrl = `${origin}/nowe-haslo.html?token=${token}`;

    // 3) Treść maila
    const text = [
      'Cześć!',
      '',
      'Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta w aplikacji CzyziuMakro.',
      'Jeśli to Ty, wejdź w ten link (ważny 1 godzinę):',
      resetUrl,
      '',
      'Jeśli to nie Ty, po prostu zignoruj tę wiadomość – hasło nie zostanie zmienione.',
      '',
      'Pozdrawiamy,',
      'Zespół CzyziuMakro',
    ].join('\n');

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Reset hasła — CzyziuMakro',
      text,
    });

    return res.json({ ok: true, message: genericMsg });
  } catch (e) {
    console.error('POST /api/password/forgot error:', e);
    return res.status(500).json({ message: 'Błąd serwera.' });
  }
});

// ============================================================================
// POST /api/password/reset
// body: { token, password }
// ============================================================================
router.post('/reset', async (req, res) => {
  try {
    const { token, password } = req.body || {};

    if (!token || !password) {
      return res
        .status(400)
        .json({ message: 'Brak tokenu lub nowego hasła.' });
    }
    if (String(password).length < 6) {
      return res
        .status(400)
        .json({ message: 'Hasło musi mieć co najmniej 6 znaków.' });
    }

    console.log('[RESET] token z body:', token);

    // Szukamy usera po tokenie, ważność > teraz
    const user = await User.findOne({
      resetPasswordToken: String(token),
      resetPasswordExpires: { $gt: new Date() },
    }).exec();

    console.log(
      '[RESET] znaleziony user:',
      user ? user._id : null,
      'expires:',
      user ? user.resetPasswordExpires : null
    );

    if (!user) {
      return res
        .status(400)
        .json({ message: 'Token jest nieprawidłowy lub wygasł.' });
    }

    // Ustawiamy nowe hasło przez metodę z modelu (passwordHash)
    await user.setPassword(String(password));
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({
      ok: true,
      message: 'Hasło zostało zmienione. Możesz się zalogować.',
    });
  } catch (e) {
    console.error('POST /api/password/reset error:', e);
    return res.status(500).json({ message: 'Błąd serwera.' });
  }
});

module.exports = router;
