require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

/**
 * HEALTH CHECK
 * Railway bununla ayakta mı diye bakar
 */
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * ROOT
 */
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'moti-proxy' });
});

/**
 * START SERVER
 * ⚠️ MUTLAKA 0.0.0.0
 */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MOTI proxy running on port ${PORT}`);
});
