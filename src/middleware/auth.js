// src/middleware/auth.js
const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Brak tokena' });

    const secret = process.env.JWT_SECRET || 'supersecretjwt';
    const payload = jwt.verify(token, secret);

    const id =
      payload.userId ||
      payload.id ||
      payload.sub ||
      (payload.user && (payload.user.id || payload.user._id)) ||
      payload._id;

    if (!id) return res.status(401).json({ message: 'Token bez userId' });

    req.user = { id: String(id) };
    next();
  } catch (e) {
    console.error('AUTH ERROR:', e?.message || e);
    return res.status(401).json({ message: 'Nieautoryzowany' });
  }
};
