require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Railway PORT (ZORUNLU)
const PORT = process.env.PORT || 8080;

// ==================
// HEALTH CHECK
// ==================
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "moti-proxy" });
});

// ==================
// ROOT
// ==================
app.get("/", (req, res) => {
  res.json({ ok: true, name: "moti-proxy" });
});

// ==================
// CHAT ENDPOINT
// ==================
app.post("/chat", async (req, res) => {
  try {
    const { message = "" } = req.body;

    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OPENROUTER_API_KEY missing",
      });
    }

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: message }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      ok: true,
      reply: response.data.choices[0].message.content,
