require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PROVIDER = (process.env.PROVIDER || 'openrouter').toLowerCase();
const MODEL = process.env.MODEL || 'openai/gpt-4o-mini';

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'moti-proxy',
    provider: PROVIDER,
    model: MODEL,
  });
});

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'empty_message',
      });
    }

    // ✅ OPENROUTER
    if (PROVIDER === 'openrouter') {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: MODEL,
          messages: [
            {
              role: 'system',
              content:
                "Sen Moti'sin. Türkçe konuş. Kısa, sıcak ve uygulanabilir cevaplar ver.",
            },
            {
              role: 'user',
              content: message,
            },
          ],
          temperature: 0.4,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://moti.app',
            'X-Title': 'MOTI Proxy',
          },
          timeout: 20000,
        }
      );

      const reply =
        response.data?.choices?.[0]?.message?.content?.trim();

      return res.json({
        ok: true,
        reply,
      });
    }

    // ❌ başka provider yok
    return res.status(400).json({
      ok: false,
      error: 'unsupported_provider',
      provider: PROVIDER,
    });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: 'proxy_error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 MOTI proxy running on port ${PORT}`);
});
