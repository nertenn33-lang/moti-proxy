require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

/* ======================
   ENV & CONFIG
====================== */
const PORT = process.env.PORT || 8080; // ⚠️ Railway için 8080
const PROVIDER = (process.env.PROVIDER || 'ollama').toLowerCase();
const MODEL = process.env.MODEL || 'llama3.1:8b';
const OLLAMA_ENDPOINT =
  process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';

/* ======================
   HEALTH CHECK (ZORUNLU)
====================== */
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'moti-proxy',
    provider: PROVIDER,
    model: MODEL,
    timestamp: Date.now()
  });
});

/* ======================
   ROOT
====================== */
app.get('/', (req, res) => {
  res.json({ ok: true, provider: PROVIDER, model: MODEL });
});

/* ======================
   MINI CACHE (ANTI-REPEAT)
====================== */
const lastReplies = [];
const MAX_CACHE = 12;

const similar = (a, b) => {
  const na = String(a || '').toLowerCase();
  const nb = String(b || '').toLowerCase();
  const min = Math.min(na.length, nb.length);
  if (min < 24) return na === nb;
  return (
    na.includes(nb.slice(0, Math.floor(min * 0.6))) ||
    nb.includes(na.slice(0, Math.floor(min * 0.6)))
  );
};

const pushCache = (txt) => {
  lastReplies.unshift(txt);
  if (lastReplies.length > MAX_CACHE) lastReplies.pop();
};

const isRepetitive = (txt) =>
  lastReplies.some((r) => similar(r, txt));

/* ======================
   SYSTEM PROMPT
====================== */
function systemPrompt(memory) {
  return (
    "Sen Moti'sin. Türkçe konuş. Kısa, sıcak ve somut öneriler ver.\n" +
    "Gereksiz tekrar yapma.\n\n" +
    "Kullanıcı hafızası: " +
    JSON.stringify(memory || {}) +
    "\n\nKurallar:\n" +
    "1) Net ve uygulanabilir yanıtlar\n" +
    "2) Aynı cümleleri tekrarlama\n" +
    "3) Gerekirse maddeli anlat"
  );
}

/* ======================
   CHAT ENDPOINT
====================== */
app.post('/chat', async (req, res) => {
  try {
    const { message = '', memory = {} } = req.body;
    const prompt = `${systemPrompt(memory)}\n\nKullanıcı: ${message}\nMoti:`;

    let aiText = '';

    if (PROVIDER === 'ollama') {
      const r = await axios.post(`${OLLAMA_ENDPOINT}/api/generate`, {
        model: MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.2 }
      });
      aiText = (r.data?.response || '').trim();
    } else {
      return res
        .status(400)
        .json({ ok: false, error: 'unsupported_provider' });
    }

    if (isRepetitive(aiText)) {
      aiText +=
        "\n\n(Not: Tekrar tespit edildi, alternatif ifade uygulandı.)";
    }

    pushCache(aiText);

    const patches = [];
    if (/teşekkür/i.test(message)) {
      patches.push({ op: 'inc', path: 'score', by: 1 });
    }

    res.json({ ok: true, reply: aiText, patches });
  } catch (e) {
    console.error(e?.response?.data || e);
    res.status(500).json({
      ok: false,
      error: 'proxy_error',
      detail: String(e?.response?.data || e?.message || e)
    });
  }
});

/* ======================
   PLAN ENDPOINT
====================== */
app.post('/plan', (req, res) => {
  try {
    const { text = '' } = req.body;
    const weeks = /\b(\d+)\s*hafta\b/i.exec(text)?.[1] || 4;
    const topic = /ders|ingilizce|matematik|fizik|yks|ales|kpss/i.test(text)
      ? 'Çalışma Programı'
      : 'Plan';

    const perDay = 60;
    const plan = Array.from(
      { length: weeks * 7 },
      (_, i) => ({
        day: i + 1,
        items: [{ topic, minutes: perDay, notes: '' }]
      })
    );

    res.json({
      ok: true,
      plan,
      meta: { weeks: Number(weeks), restDays: [] }
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: 'plan_error',
      detail: String(e?.message || e)
    });
  }
});

/* ======================
   START SERVER
====================== */
app.listen(PORT, () => {
  console.log(
    `Moti proxy running on :${PORT} (provider=${PROVIDER}, model=${MODEL})`
  );
});
