// CommonJS
const mongoose = require('mongoose');
const { Schema } = mongoose;

// Predefiniowane kategorie – takie jak na froncie
const CATEGORIES = Object.freeze([
  'Mięso',
  'Ryby i owoce morza',
  'Nabiał',
  'Zboża i pieczywo',
  'Warzywa',
  'Owoce',
  'Orzechy i nasiona',
  'Tłuszcze',
  'Słodycze i przekąski',
  'Napoje',
  'Gotowe / przetworzone',
  'Przyprawy i sosy',
]);

const ProductSchema = new Schema(
  {
    // jeśli w JWT masz _id użytkownika, lepiej trzymaj jako ObjectId:
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, enum: CATEGORIES, required: true },

    kcal100: { type: Number, min: 0 },
    p100:    { type: Number, min: 0 }, // białko
    f100:    { type: Number, min: 0 }, // tłuszcz
    c100:    { type: Number, min: 0 }, // węgle
  },
  { timestamps: true }
);

ProductSchema.index({ userId: 1, name: 1 });

const Product = mongoose.model('Product', ProductSchema);

// Eksportujmy spójnie jako obiekt:
module.exports = { Product, CATEGORIES };
