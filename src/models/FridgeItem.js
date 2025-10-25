// src/models/FridgeItem.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const FridgeItemSchema = new Schema(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    grams:     { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

// 1 user ⇄ 1 produkt (unikalna pozycja w lodówce)
FridgeItemSchema.index({ userId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('FridgeItem', FridgeItemSchema);
