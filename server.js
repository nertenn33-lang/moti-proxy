require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Railway PORT (ZORUNLU)
 */
const PORT = process.env.PORT || 8080;

/**
 * OpenRouter
 */
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.MODEL || "gpt-4o-mini";

/**
 * HEALTH CHECK (Railway için şart)
 */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "moti-proxy",
    model: MODEL,
    time: new Date().toISOString(),
  });
});

/**
 * CHAT ENDPOINT
 */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ ok: false, error: "message_required" });
    }

    const response = await axios.post(
      OPENROUTER_URL,
      {
        model: MODEL,
        messages: [
          { role: "system", content: "Sen Moti'sin. Türkçe, kısa ve net cevap ver." },
          { role: "user", content: message }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      ok: true,
      reply: response.data.choices[0].message.content
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      ok: false,
      error: "proxy_error",
      detail: err.response?.data || err.message
    });
  }
});

/**
 * START
 */
app.listen(PORT, () => {
  console.log(`🚀 MOTI proxy running on port ${PORT}`);
});
