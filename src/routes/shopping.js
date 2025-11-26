// src/routes/shopping.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const path = require('path'); // <– potrzebne do join()

// __dirname = .../CzyziuMacro/src/routes
// chcemy:   .../CzyziuMacro/public/assets/fonts/DejaVuSans.ttf
const FONT_PATH = path.join(
  __dirname,
  '..',        // -> src
  '..',        // -> root (CzyziuMacro)
  'public',
  'assets',
  'fonts',
  'DejaVuSans.ttf'
);

// ── Transporter maila (Gmail / inny SMTP) ─────────────────────────────────────
let transporter = null;

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.warn('⚠️ SMTP_USER lub SMTP_PASS nie ustawione – wysyłka listy zakupów na maila nie będzie działać.');
} else {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== 'false', // 465 → true, 587 → false
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Proste generowanie PDF z listą zakupów
async function createShoppingPdf(items, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Ustawiamy font z polskimi znakami
    try {
      doc.font(FONT_PATH);
    } catch (e) {
      console.error('Nie udało się załadować fontu PDF:', e);
      // jeśli font się nie wczyta, PDFKit użyje domyślnego – ale wtedy polskie znaki znowu mogą być popsute
    }

    doc.fontSize(18).text('Lista zakupów', { align: 'left' });

    if (meta.from && meta.to) {
      doc.moveDown().fontSize(12).text(`Zakres: ${meta.from} – ${meta.to}`);
    }

    doc.moveDown();

    items.forEach((it) => {
      doc.fontSize(12).text(`• ${it.name}: ${it.grams} g`);
    });

    doc.end();
  });
}

// POST /api/shopping/email
// body: { from, to, consume, items: [ { productId, name, grams } ] }
router.post('/email', auth, async (req, res) => {
  try {
    const { from, to, consume, items } = req.body || {};

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'Brak pozycji na liście zakupów.' });
    }

    if (!transporter) {
      return res
        .status(500)
        .json({ message: 'Wysyłka e-maila nie jest skonfigurowana (brak SMTP_USER/SMTP_PASS).' });
    }

    const user = await User.findById(req.user.id).lean();
    const toEmail = user?.email;
    if (!toEmail) {
      return res.status(400).json({ message: 'Brak adresu e-mail użytkownika.' });
    }

    const niceFrom = from || '';
    const niceTo = to || '';

    const lines = [];
    lines.push('Cześć!', '');
    lines.push('Poniżej Twoja lista zakupów z aplikacji CzyziuMakro.');

    if (niceFrom && niceTo) {
      lines.push(`Zakres: ${niceFrom} – ${niceTo}`);
    }

    lines.push('');
    items.forEach((it) => {
      lines.push(`- ${it.name}: ${it.grams} g`);
    });

    if (consume) {
      lines.push('');
      lines.push(
        'Uwaga: zaznaczono opcję „Usuń zużyte z lodówki” — lista uwzględnia stan lodówki.'
      );
    }

    lines.push('', 'Pozdrawiamy,', 'CzyziuMakro');
    const text = lines.join('\n');

    const pdfBuffer = await createShoppingPdf(items, { from: niceFrom, to: niceTo });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject: 'Twoja lista zakupów — CzyziuMakro',
      text,
      attachments: [
        {
          filename: 'lista-zakupow.pdf',
          content: pdfBuffer,
        },
      ],
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/shopping/email error:', e);
    return res.status(500).json({ message: 'Błąd wysyłki e-maila.' });
  }
});

module.exports = router;
