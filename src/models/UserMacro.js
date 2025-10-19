// /backend/models/UserMacro.js
const mongoose = require('mongoose');

const UserMacroSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  kcal:     { type: Number, required: true },
  carbs_g:  { type: Number, required: true },
  fat_g:    { type: Number, required: true },
  protein_g:{ type: Number, required: true },
  method:   { type: String, enum: ['beginner','advanced'], required: true },
  pa:       { type: Number, required: true },                 // współczynnik aktywności (PA)
  goal:     { type: String, enum: ['loss','maintain','gain'], default: 'maintain' }
}, { timestamps: true });

module.exports = mongoose.model('UserMacro', UserMacroSchema);
