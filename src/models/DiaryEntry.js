// models/DiaryEntry.js  (CommonJS)
const mongoose = require('mongoose');
const { Schema } = mongoose;

// 5 slotów w Twoim kalendarzu
const MEAL_SLOTS = Object.freeze([
  'Śniadanie',
  'II śniadanie',
  'Obiad',
  'Podwieczorek',
  'Kolacja',
]);

// Pozycja w danym posiłku danego dnia
const DiaryItemSchema = new Schema(
  {
    // referencja do produktu (z Twojego Product.js)
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    grams: { type: Number, min: 1, required: true }
  },
  { _id: true, timestamps: true }
);

const DiaryEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // data w formacie YYYY-MM-DD (bez strefy)
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    // nazwa slotu (kategorii posiłku z kalendarza)
    slot: { type: String, enum: MEAL_SLOTS, required: true, index: true },

    // lista rzeczy dodanych do tego posiłku
    items: { type: [DiaryItemSchema], default: [] }
  },
  { timestamps: true }
);

DiaryEntrySchema.index({ userId: 1, date: 1, slot: 1 }, { unique: true });

const DiaryEntry = mongoose.model('DiaryEntry', DiaryEntrySchema);
module.exports = { DiaryEntry, MEAL_SLOTS };
