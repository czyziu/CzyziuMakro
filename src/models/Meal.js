// models/Meal.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const MEAL_CATEGORIES = Object.freeze([
  'Śniadanie',
  'Obiad',
  'Kolacja',
  'Przekąska',
  'Deser',
  'Inne',
]);

const IngredientSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    grams: { type: Number, min: 1, required: true },
  },
  { _id: false }
);

const MealSchema = new Schema(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:     { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, enum: MEAL_CATEGORIES, required: true },

    // Pola opcjonalne z frontu:
    portions:   { type: Number, min: 1, default: 1 },
    postWeight: { type: Number, min: 0, default: 0 },
    recipe:     { type: String, default: '' },
    isPublic:   { type: Boolean, default: false },

    ingredients: {
      type: [IngredientSchema],
      validate: v => Array.isArray(v) && v.length >= 2,
    },
  },
  { timestamps: true }
);

MealSchema.index({ userId: 1, name: 1 });

const Meal = mongoose.model('Meal', MealSchema);
module.exports = { Meal, MEAL_CATEGORIES };
