// src/routes/summary.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const SummaryNote = require('../models/SummaryNote');

// GET /api/summary/notes
// Zwraca listę notatek zalogowanego usera (najnowsze na górze)
router.get('/notes', auth, async (req, res) => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit, 10) || 50,
      200 // bez przesady :)
    );

    const notes = await SummaryNote.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      ok: true,
      notes: notes.map((n) => ({
        id: n._id,
        text: n.text,
        createdAt: n.createdAt,
      })),
    });
  } catch (e) {
    console.error('GET /api/summary/notes error:', e);
    return res.status(500).json({ message: 'Błąd serwera.' });
  }
});

// POST /api/summary/notes
// body: { text: string }
router.post('/notes', auth, async (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ message: 'Treść notatki jest wymagana.' });
    }

    const note = await SummaryNote.create({
      userId: req.user.id,
      text: text.trim(),
    });

    return res.status(201).json({
      ok: true,
      note: {
        id: note._id,
        text: note.text,
        createdAt: note.createdAt,
      },
    });
  } catch (e) {
    console.error('POST /api/summary/notes error:', e);
    return res.status(500).json({ message: 'Błąd serwera.' });
  }
});

module.exports = router;
