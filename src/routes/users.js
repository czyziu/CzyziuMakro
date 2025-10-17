const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user._id, email: user.email, name: user.name });
});

module.exports = router;
