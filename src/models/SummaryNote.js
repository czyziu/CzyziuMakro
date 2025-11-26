// src/models/SummaryNote.js
const mongoose = require('mongoose');

const SummaryNoteSchema = new mongoose.Schema(
  {
    // Do kogo należy notatka
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Treść notatki
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

module.exports = mongoose.model('SummaryNote', SummaryNoteSchema);
