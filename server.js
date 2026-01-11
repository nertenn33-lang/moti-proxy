require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// ✅ express.json() MUST be before routes
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0'; // ✅ MUST bind to 0.0.0.0 for Railway
const PROVIDER = (process.env.PROVIDER || 'openrouter').toLowerCase();
const MODEL = process.env.MODEL || 'openai/gpt-4o-mini';

// ✅ Log on server startup
console.log('🚀 MOTI Proxy Server Starting...');
console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔌 Port: ${PORT}`);
console.log(`🤖 Provider: ${PROVIDER}`);
console.log(`🧠 Model: ${MODEL}`);
console.log(`🔑 OpenRouter API Key: ${process.env.OPENROUTER_API_KEY ? '✅ Set' : '❌ Missing'}`);

// ✅ Health endpoint
app.get('/health', (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /health`);
  res.json({
    ok: true,
    service: 'moti-proxy',
    provider: PROVIDER,
    model: MODEL,
  });
});
console.log('✅ Registered: GET /health');

// ✅ Test endpoint - no AI call, just confirm route works
app.post('/moti/chat/test', (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /moti/chat/test`);
  res.json({
    ok: true,
    route: 'test',
  });
});
console.log('✅ Registered: POST /moti/chat/test');

// ✅ Live endpoint - minimal real OpenRouter call
app.post('/moti/chat/live', async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /moti/chat/live`);
  
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('❌ OPENROUTER_API_KEY not set');
      return res.status(500).json({
        ok: false,
        error: 'api_key_missing',
      });
    }

    console.log('📡 Sending test request to OpenRouter...');
    const startTime = Date.now();
    
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: 'Say "ok"',
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

    const duration = Date.now() - startTime;
    console.log(`✅ OpenRouter response: ${response.status} (${duration}ms)`);
    
    return res.json({
      ok: true,
      ai: 'working',
    });
  } catch (err) {
    const status = err?.response?.status || 'unknown';
    const errorData = err?.response?.data || err.message;
    console.error(`❌ OpenRouter error [${status}]:`, errorData);
    
    return res.status(500).json({
      ok: false,
      error: 'openrouter_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: POST /moti/chat/live');

// ✅ Main chat endpoint - forward to OpenRouter
app.post('/moti/chat', async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /moti/chat`);
  console.log(`📥 Request body:`, JSON.stringify({ message: req.body?.message ? '***' : 'missing' }));
  
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      console.log('❌ Empty message received');
      return res.status(400).json({
        ok: false,
        error: 'empty_message',
      });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      console.error('❌ OPENROUTER_API_KEY not set');
      return res.status(500).json({
        ok: false,
        error: 'api_key_missing',
      });
    }

    // ✅ OPENROUTER
    if (PROVIDER === 'openrouter') {
      console.log(`📡 Sending to OpenRouter (${MODEL})...`);
      const startTime = Date.now();
      
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

      const duration = Date.now() - startTime;
      const status = response.status;
      console.log(`✅ OpenRouter response: ${status} (${duration}ms)`);
      
      const reply = response.data?.choices?.[0]?.message?.content?.trim();
      
      if (!reply) {
        console.error('❌ No reply in OpenRouter response:', JSON.stringify(response.data));
        return res.status(500).json({
          ok: false,
          error: 'no_reply',
        });
      }

      console.log(`📤 Sending reply (${reply.length} chars)`);
      // ✅ Response format: { reply: string }
      return res.json({
        reply,
      });
    }

    // ❌ başka provider yok
    console.error(`❌ Unsupported provider: ${PROVIDER}`);
    return res.status(400).json({
      ok: false,
      error: 'unsupported_provider',
      provider: PROVIDER,
    });
  } catch (err) {
    const status = err?.response?.status || 'unknown';
    const errorData = err?.response?.data || err.message;
    console.error(`❌ Error [${status}]:`, errorData);
    
    return res.status(500).json({
      ok: false,
      error: 'proxy_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: POST /moti/chat');

// ✅ Bind to 0.0.0.0 for Railway
app.listen(PORT, HOST, () => {
  console.log(`🚀 MOTI proxy running on ${HOST}:${PORT}`);
  console.log(`🌐 Health check: http://${HOST}:${PORT}/health`);
  console.log(`💬 Chat endpoint: http://${HOST}:${PORT}/moti/chat`);
  console.log(`🧪 Test endpoint: http://${HOST}:${PORT}/moti/chat/test`);
  console.log(`🔬 Live endpoint: http://${HOST}:${PORT}/moti/chat/live`);
  console.log('✅ Server ready!');
});
