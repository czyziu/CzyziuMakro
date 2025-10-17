const router = require('express').Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'czyziumakro', time: new Date().toISOString() });
});

module.exports = router;
