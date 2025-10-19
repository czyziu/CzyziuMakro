// src/models/Profile.js
const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, unique: true, required: true },

    age:      { type: Number, min: 18,  max: 120,  required: true },
    weight:   { type: Number, min: 20,  max: 400,  required: true },
    height:   { type: Number, min: 100, max: 250,  required: true },  // 🆕 WZROST (cm)
    activity: { type: Number, enum: [1, 2, 3, 4, 5], required: true },
    sex:      { type: String, enum: ['F', 'M'],      required: true },
    level:    { type: String, enum: ['basic', 'advanced'], required: true },
    goal:     { type: String, enum: ['loss', 'maintain', 'gain'], required: true },

    completed: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// (opcjonalnie) twardy indeks unikalny — i tak jest dzięki `unique: true`
ProfileSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Profile', ProfileSchema);
