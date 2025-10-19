// src/middleware/auth.js
const jwt = require('jsonwebtoken');

/** AUTH — Bearer JWT → ustawia req.user.id */
function auth(req, res, next) {
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
}

/**
 * VALIDATE — middleware pod Zod (lub inny schema z .safeParse)
 * Użycie: router.post('/x', validate(zodSchema), handler)
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      // zakładamy obiekt ze .safeParse (np. zod)
      const result = schema.safeParse(req.body || {});
      if (!result.success) {
        const issue = result.error?.issues?.[0];
        return res.status(400).json({
          message: issue?.message || 'Błędne dane',
          path: issue?.path || [],
        });
      }
      req.validated = result.data;
      next();
    } catch (err) {
      // gdyby przekazano inny typ schema
      return res.status(400).json({ message: 'Błędne dane (validate)' });
    }
  };
}

// Eksporty zgodne i wstecznie kompatybilne
module.exports = auth;          // default (jak dotąd)
module.exports.auth = auth;     // named
module.exports.validate = validate; // named
