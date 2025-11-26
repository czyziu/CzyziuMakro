// src/routes/contact.js
const express = require('express');
const nodemailer = require('nodemailer');

const router = express.Router();

// ── Mail: konfiguracja nodemailer (Gmail) ─────────────────────────────────────
let transporter = null;

if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
  console.warn(
    '⚠️ MAIL_USER lub MAIL_PASS nie jest ustawione – formularz kontaktowy będzie nieaktywny.'
  );
} else {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS, // hasło aplikacji Google
    },
  });
}

/**
 * POST /api/contact
 * body: { name, email, subject, message, consent }
 */
router.post('/', async (req, res) => {
  const { name, email, subject, message, consent } = req.body || {};

  if (!name || !email || !subject || !message || !consent) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  if (!transporter) {
    return res.status(500).json({ ok: false, error: 'MAIL_NOT_CONFIGURED' });
  }

  const mailOptions = {
    from: `"CzyziuMakro — formularz" <${process.env.MAIL_USER}>`,
    to: process.env.MAIL_TO || process.env.MAIL_USER,
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

module.exports = router;
