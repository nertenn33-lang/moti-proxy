require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

/* =======================
   MIDDLEWARE
======================= */
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* =======================
   ENV (RAILWAY UYUMLU)
======================= */
const PORT = process.env.PORT; // ❗ SABİT PORT YOK
const PROVIDER = (process.env.PROVIDER || "ollama").toLowerCase();
const MODEL = process.env.MODEL || "llama3.1:8b";
const OLLAMA_ENDPOINT =
  process.env.OLLAMA_ENDPOINT || "http://127.0.0.1:11434";

/* =======================
   HEALTH CHECK (ŞART)
======================= */
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "moti-proxy",
    provider: PROVIDER,
    model: MODEL,
  });
});

/* =======================
   ROOT
======================= */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "MOTI Proxy is running",
  });
});

/* =======================
   CHAT ENDPOINT
======================= */
app.post("/chat", async (req, res) => {
  try {
    const { message = "" } = req.body;

    if (!message) {
      return res.status(400).json({ ok: false, error: "empty_message" });
    }

    if (PROVIDER !== "ollama") {
      return res
        .status(400)
        .json({ ok: false, error: "unsupported_provider" });
    }

    const prompt = `Sen Moti'sin. Türkçe konuş.\n\nKullanıcı: ${message}\nMoti:`;

    const response = await axios.post(`${OLLAMA_ENDPOINT}/api/generate`, {
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2 },
    });

    const reply = response.data?.response?.trim() || "";

    res.json({
      ok: true,
      reply,
    });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({
      ok: false,
      error: "proxy_error",
    });
  }
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 MOTI proxy running on port", PORT);
});
