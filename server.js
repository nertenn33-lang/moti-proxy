require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Railway mutlaka PORT verir. Biz de ona birebir uyarız.
const PORT = Number(process.env.PORT || 8080);

// Provider ayarı
const PROVIDER = (process.env.PROVIDER || "openrouter").toLowerCase();
const MODEL = process.env.MODEL || "openai/gpt-4o-mini";

// OpenRouter
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

// Ollama (lokalde)
const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || "http://127.0.0.1:11434";

// --- MUTLAKA: health endpoint (takılmayan, anında dönen) ---
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "moti-proxy", ts: Date.now() });
});

// root da hızlı cevap versin
app.get("/", (req, res) => {
  res.status(200).json({ ok: true, provider: PROVIDER, model: MODEL });
});

// Basit tekrar önleme (mini cache)
const lastReplies = [];
const MAX_CACHE = 12;
const similar = (a, b) => {
  const na = String(a || "").toLowerCase();
  const nb = String(b || "").toLowerCase();
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
const isRepetitive = (txt) => lastReplies.some((r) => similar(r, txt));

function systemPrompt(memory) {
  return (
    "Sen Moti'sin. Türkçe konuş. Kısa, sıcak ve somut öneriler ver. Gereksiz tekrar yapma.\n\n" +
    "Kullanıcı hafızası: " +
    JSON.stringify(memory || {}) +
    ".\n" +
    "Kurallar: 1) Net ve uygulanabilir yanıtlar 2) Aynı cümleleri tekrarlama 3) Gerekirse maddeli ver."
  );
}

app.post("/chat", async (req, res) => {
  try {
    const { message = "", memory = {} } = req.body;
    const prompt = `${systemPrompt(memory)}\n\nKullanıcı: ${message}\nMoti:`;

    let aiText = "";

    if (PROVIDER === "openrouter") {
      if (!OPENROUTER_API_KEY) {
        return res.status(500).json({
          ok: false,
          error: "missing_openrouter_key",
          detail: "OPENROUTER_API_KEY env yok.",
        });
      }

      const r = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt(memory) },
            { role: "user", content: message },
          ],
          temperature: 0.2,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 20000, // takılmasın diye
        }
      );

      aiText = (r.data?.choices?.[0]?.message?.content || "").trim();
    } else if (PROVIDER === "ollama") {
      const r = await axios.post(
        `${OLLAMA_ENDPOINT}/api/generate`,
        { model: MODEL, prompt, stream: false, options: { temperature: 0.2 } },
        { timeout: 20000 }
      );
      aiText = (r.data?.response || "").trim();
    } else {
      return res.status(400).json({
        ok: false,
        error: "unsupported_provider",
        provider: PROVIDER,
      });
    }

    if (isRepetitive(aiText)) {
      aiText += "\n\n(Not: Tekrar tespit edildi, alternatif ifade uygulandı.)";
    }
    pushCache(aiText);

    const patches = [];
    if (/teşekkür/i.test(message)) patches.push({ op: "inc", path: "score", by: 1 });

    res.json({ ok: true, reply: aiText, patches });
  } catch (e) {
    console.error(e?.response?.data || e);
    res.status(500).json({
      ok: false,
      error: "proxy_error",
      detail: String(e?.response?.data || e?.message || e),
    });
  }
});

app.post("/plan", async (req, res) => {
  try {
    const { text = "" } = req.body;
    const weeks = /\b(\d+)\s*hafta\b/i.exec(text)?.[1] || 4;
    const topic = /ders|ingilizce|matematik|fizik|yks|ales|kpss/i.test(text)
      ? "Çalışma Programı"
      : "Plan";
    const perDay = 60;
    const plan = Array.from({ length: Number(weeks) * 7 }, (_, i) => ({
      day: i + 1,
      items: [{ topic, minutes: perDay, notes: "" }],
    }));
    res.json({ ok: true, plan, meta: { weeks: Number(weeks), restDays: [] } });
  } catch (e) {
    res.status(500).json({ ok: false, error: "plan_error", detail: String(e?.message || e) });
  }
});

// KRİTİK: 0.0.0.0 bind → Railway dışarıdan erişebilsin
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ MOTI proxy running on port ${PORT} (provider=${PROVIDER}, model=${MODEL})`);
});
