const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },

    weightKg: { type: Number },
    heightCm: { type: Number },
    age: { type: Number },
    sex: { type: String, enum: ['male', 'female', 'other'], default: 'other' },

    // Pola do resetu hasła (opcjonalne)
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
  },
  { timestamps: true }
);

// Ustawianie hasła (używane przy rejestracji i resetowaniu)
UserSchema.methods.setPassword = async function (plain) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plain, salt);
};

// Sprawdzanie hasła przy logowaniu
UserSchema.methods.validatePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
