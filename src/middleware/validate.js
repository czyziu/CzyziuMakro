// src/middleware/validate.js
const { ZodError } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      const issue = result.error.issues?.[0];
      return res.status(400).json({
        message: issue?.message || 'Błędne dane',
        path: issue?.path || [],
      });
    }
    req.validated = result.data;
    next();
  };
}

// podwójny eksport, żeby import zawsze zadziałał
module.exports = validate;          // default
module.exports.validate = validate; // named
