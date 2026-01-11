require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const planService = require('./planService');

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

// ✅ Main chat endpoint - forward to OpenRouter with plan context
app.post('/moti/chat', async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /moti/chat`);
  console.log(`📥 Request body:`, JSON.stringify({ message: req.body?.message ? '***' : 'missing' }));
  
  try {
    const { message, userId, planId } = req.body;
    
    // ✅ Get plan context if planId provided
    let planContext = null;
    if (userId && planId) {
      planContext = planService.getPlanContext(userId, planId);
      if (planContext) {
        console.log(`📋 Plan context loaded: ${planContext.planName} (Day ${planContext.currentDay})`);
      }
    }

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
      
      // ✅ Build system message with plan context if available
      let systemMessage = "Sen Moti'sin. Türkçe konuş. Kısa, sıcak ve uygulanabilir cevaplar ver.";
      
      if (planContext) {
        const tasksStatus = planContext.completionStatus.completed === planContext.completionStatus.total 
          ? 'Tamamlandı!' 
          : `${planContext.completionStatus.completed}/${planContext.completionStatus.total} tamamlandı`;
        
        systemMessage += `\n\nKullanıcı "${planContext.planName}" planıyla ilgili konuşuyor. Bu plan: Gün ${planContext.currentDay}. Bugünün görevleri: ${tasksStatus}.`;
        systemMessage += `\nSadece bu plan hakkında konuş. Başka planlardan bahsetme.`;
      }
      
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: systemMessage,
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

// ============================================================================
// 📋 PLAN SYSTEM ENDPOINTS
// ============================================================================

// ✅ GET /plans - Get all active plans for user (home screen)
app.get('/plans', (req, res) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  console.log(`[${new Date().toISOString()}] GET /plans for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
      message: 'userId required in X-User-Id header or query parameter',
    });
  }
  
  try {
    const plans = planService.getUserPlans(userId);
    
    // Format plans for home screen cards
    const planCards = plans.map(plan => {
      const completion = planService.getCompletionStatus(plan);
      const todayTasks = planService.getTodayTasks(plan);
      
      return {
        id: plan.id,
        name: plan.name,
        type: plan.type,
        currentDay: plan.currentDay,
        todayTasks: todayTasks.map(t => ({
          id: t.id,
          title: t.title,
          completed: t.completed,
        })),
        completionStatus: {
          completed: completion.completed,
          total: completion.total,
          percentage: completion.percentage,
        },
        lastProcessedDate: plan.lastProcessedDate,
      };
    });
    
    console.log(`✅ Returned ${planCards.length} plan(s) for user ${userId}`);
    return res.json({
      ok: true,
      plans: planCards,
    });
  } catch (err) {
    console.error(`❌ Error getting plans:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: GET /plans');

// ✅ POST /plans - Create new plan with subscription check
app.post('/plans', (req, res) => {
  const userId = req.headers['x-user-id'] || req.body.userId;
  const userTier = req.headers['x-user-tier'] || req.body.userTier || 'free';
  const { name, type, tasks, metadata } = req.body;
  
  console.log(`[${new Date().toISOString()}] POST /plans for user ${userId} (${userTier})`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
      message: 'userId required in X-User-Id header or body',
    });
  }
  
  try {
    // ✅ Check subscription limits
    const canCreate = planService.canCreatePlan(userId, userTier);
    
    if (!canCreate.canCreate) {
      console.log(`🚫 Plan creation blocked for user ${userId}: ${canCreate.reason}`);
      return res.status(403).json({
        ok: false,
        error: canCreate.reason,
        message: canCreate.message,
        requiresPremium: true,
      });
    }
    
    // ✅ Create plan
    const plan = planService.createPlan(userId, {
      name,
      type,
      tasks,
      metadata,
    });
    
    const completion = planService.getCompletionStatus(plan);
    
    console.log(`✅ Created plan ${plan.id} for user ${userId}`);
    return res.status(201).json({
      ok: true,
      plan: {
        id: plan.id,
        name: plan.name,
        type: plan.type,
        currentDay: plan.currentDay,
        lastProcessedDate: plan.lastProcessedDate,
        tasks: plan.tasks || [],
        completionStatus: completion,
      },
    });
  } catch (err) {
    console.error(`❌ Error creating plan:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: POST /plans');

// ✅ GET /plans/:id - Get specific plan
app.get('/plans/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  const planId = req.params.id;
  
  console.log(`[${new Date().toISOString()}] GET /plans/${planId} for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
    });
  }
  
  try {
    const plan = planService.getPlanById(userId, planId);
    
    if (!plan) {
      return res.status(404).json({
        ok: false,
        error: 'plan_not_found',
      });
    }
    
    const completion = planService.getCompletionStatus(plan);
    const todayTasks = planService.getTodayTasks(plan);
    
    return res.json({
      ok: true,
      plan: {
        id: plan.id,
        name: plan.name,
        type: plan.type,
        currentDay: plan.currentDay,
        lastProcessedDate: plan.lastProcessedDate,
        todayTasks: todayTasks,
        completionStatus: completion,
        tasks: plan.tasks || [],
        metadata: plan.metadata || {},
      },
    });
  } catch (err) {
    console.error(`❌ Error getting plan:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: GET /plans/:id');

// ✅ PUT /plans/:id/tasks/:taskId/complete - Complete a task (NO day advance)
app.put('/plans/:id/tasks/:taskId/complete', (req, res) => {
  const userId = req.headers['x-user-id'] || req.body.userId;
  const planId = req.params.id;
  const taskId = req.params.taskId;
  
  console.log(`[${new Date().toISOString()}] PUT /plans/${planId}/tasks/${taskId}/complete for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
    });
  }
  
  try {
    // ✅ Complete task - this does NOT advance the day
    const plan = planService.completeTask(userId, planId, taskId);
    
    if (!plan) {
      return res.status(404).json({
        ok: false,
        error: 'plan_or_task_not_found',
      });
    }
    
    const completion = planService.getCompletionStatus(plan);
    const todayTasks = planService.getTodayTasks(plan);
    
    // Check if all tasks are complete
    const allComplete = completion.completed === completion.total && completion.total > 0;
    
    console.log(`✅ Task ${taskId} completed in plan ${planId}. Progress: ${completion.completed}/${completion.total}`);
    
    return res.json({
      ok: true,
      plan: {
        id: plan.id,
        name: plan.name,
        currentDay: plan.currentDay,
        todayTasks: todayTasks,
        completionStatus: completion,
        allComplete,
      },
    });
  } catch (err) {
    console.error(`❌ Error completing task:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: PUT /plans/:id/tasks/:taskId/complete');

// ✅ PUT /plans/:id - Update plan
app.put('/plans/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || req.body.userId;
  const planId = req.params.id;
  const { name, type, tasks, metadata } = req.body;
  
  console.log(`[${new Date().toISOString()}] PUT /plans/${planId} for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
    });
  }
  
  try {
    const plan = planService.updatePlan(userId, planId, {
      name,
      type,
      tasks,
      metadata,
    });
    
    if (!plan) {
      return res.status(404).json({
        ok: false,
        error: 'plan_not_found',
      });
    }
    
    const completion = planService.getCompletionStatus(plan);
    
    return res.json({
      ok: true,
      plan: {
        id: plan.id,
        name: plan.name,
        type: plan.type,
        currentDay: plan.currentDay,
        lastProcessedDate: plan.lastProcessedDate,
        tasks: plan.tasks || [],
        completionStatus: completion,
        metadata: plan.metadata || {},
      },
    });
  } catch (err) {
    console.error(`❌ Error updating plan:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: PUT /plans/:id');

// ✅ DELETE /plans/:id - Delete plan
app.delete('/plans/:id', (req, res) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  const planId = req.params.id;
  
  console.log(`[${new Date().toISOString()}] DELETE /plans/${planId} for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
    });
  }
  
  try {
    const deleted = planService.deletePlan(userId, planId);
    
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: 'plan_not_found',
      });
    }
    
    console.log(`✅ Deleted plan ${planId} for user ${userId}`);
    return res.json({
      ok: true,
      message: 'Plan deleted',
    });
  } catch (err) {
    console.error(`❌ Error deleting plan:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: DELETE /plans/:id');

// ✅ GET /plans/:id/context - Get plan context for AI
app.get('/plans/:id/context', (req, res) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  const planId = req.params.id;
  
  console.log(`[${new Date().toISOString()}] GET /plans/${planId}/context for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
    });
  }
  
  try {
    const context = planService.getPlanContext(userId, planId);
    
    if (!context) {
      return res.status(404).json({
        ok: false,
        error: 'plan_not_found',
      });
    }
    
    return res.json({
      ok: true,
      context,
    });
  } catch (err) {
    console.error(`❌ Error getting plan context:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: GET /plans/:id/context');

// ✅ POST /plans/:id/rollover - Force day rollover check (admin/debug endpoint)
app.post('/plans/:id/rollover', (req, res) => {
  const userId = req.headers['x-user-id'] || req.body.userId;
  const planId = req.params.id;
  
  console.log(`[${new Date().toISOString()}] POST /plans/${planId}/rollover for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
    });
  }
  
  try {
    const plan = planService.getPlanById(userId, planId);
    
    if (!plan) {
      return res.status(404).json({
        ok: false,
        error: 'plan_not_found',
      });
    }
    
    const beforeDay = plan.currentDay;
    const advanced = planService.processDayRollover(plan);
    const afterDay = plan.currentDay;
    
    return res.json({
      ok: true,
      advanced,
      beforeDay,
      afterDay,
      lastProcessedDate: plan.lastProcessedDate,
      todayDate: planService.getTodayDate(),
    });
  } catch (err) {
    console.error(`❌ Error processing rollover:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: POST /plans/:id/rollover');

// ✅ GET /plans/:id/notifications - Get notification schedule for plan
app.get('/plans/:id/notifications', (req, res) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  const planId = req.params.id;
  
  console.log(`[${new Date().toISOString()}] GET /plans/${planId}/notifications for user ${userId}`);
  
  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'user_id_required',
    });
  }
  
  try {
    const plan = planService.getPlanById(userId, planId);
    
    if (!plan) {
      return res.status(404).json({
        ok: false,
        error: 'plan_not_found',
      });
    }
    
    // ✅ Get notification schedule based on plan type
    const notificationSchedule = getNotificationSchedule(plan.type, plan.currentDay);
    
    return res.json({
      ok: true,
      planId: plan.id,
      planName: plan.name,
      planType: plan.type,
      currentDay: plan.currentDay,
      schedule: notificationSchedule,
    });
  } catch (err) {
    console.error(`❌ Error getting notification schedule:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: GET /plans/:id/notifications');

/**
 * Get notification schedule based on plan type
 * Each plan type has different notification times and messages
 */
function getNotificationSchedule(planType, currentDay) {
  const baseTimes = {
    morning: { hour: 8, minute: 0 },
    afternoon: { hour: 14, minute: 0 },
    evening: { hour: 20, minute: 0 },
  };
  
  const messages = {
    fitness: {
      morning: `💪 Gün ${currentDay}! Sabah antrenmanına hazır mısın?`,
      afternoon: `🏋️ Öğleden sonra antrenman zamanı!`,
      evening: `🎯 Gün ${currentDay} tamamlandı mı? Son kontrolleri yap!`,
    },
    study: {
      morning: `📚 Gün ${currentDay}! Bugün hangi konuları çalışacaksın?`,
      afternoon: `✏️ Öğleden sonra ders çalışma zamanı!`,
      evening: `📖 Gün ${currentDay} tamamlandı mı? Son tekrarları yap!`,
    },
    life: {
      morning: `🌟 Gün ${currentDay}! Bugün ne yapmayı planlıyorsun?`,
      afternoon: `💫 Öğleden sonra hedeflerine nasıl ilerliyorsun?`,
      evening: `✨ Gün ${currentDay} tamamlandı mı? Kendini ödüllendir!`,
    },
    default: {
      morning: `📋 Gün ${currentDay}! Bugünün görevlerini tamamlayalım!`,
      afternoon: `⏰ Öğleden sonra ilerleme kontrolü!`,
      evening: `✅ Gün ${currentDay} tamamlandı mı? Son görevleri kontrol et!`,
    },
  };
  
  const planMessages = messages[planType] || messages.default;
  
  return [
    {
      id: 'morning',
      time: baseTimes.morning,
      message: planMessages.morning,
      enabled: true,
    },
    {
      id: 'afternoon',
      time: baseTimes.afternoon,
      message: planMessages.afternoon,
      enabled: true,
    },
    {
      id: 'evening',
      time: baseTimes.evening,
      message: planMessages.evening,
      enabled: true,
    },
  ];
}

// ✅ Bind to 0.0.0.0 for Railway
app.listen(PORT, HOST, () => {
  console.log(`🚀 MOTI proxy running on ${HOST}:${PORT}`);
  console.log(`🌐 Health check: http://${HOST}:${PORT}/health`);
  console.log(`💬 Chat endpoint: http://${HOST}:${PORT}/moti/chat`);
  console.log(`🧪 Test endpoint: http://${HOST}:${PORT}/moti/chat/test`);
  console.log(`🔬 Live endpoint: http://${HOST}:${PORT}/moti/chat/live`);
  console.log('');
  console.log('📋 Plan System Endpoints:');
  console.log(`   GET    /plans - Get all plans`);
  console.log(`   POST   /plans - Create plan`);
  console.log(`   GET    /plans/:id - Get plan`);
  console.log(`   PUT    /plans/:id - Update plan`);
  console.log(`   DELETE /plans/:id - Delete plan`);
  console.log(`   PUT    /plans/:id/tasks/:taskId/complete - Complete task`);
  console.log(`   GET    /plans/:id/context - Get plan context`);
  console.log(`   GET    /plans/:id/notifications - Get notification schedule`);
  console.log(`   POST   /plans/:id/rollover - Check day rollover`);
  console.log('');
  console.log('✅ Server ready!');
});
