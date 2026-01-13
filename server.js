require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const planService = require('./planService');
const weeklyReportService = require('./weeklyReportService');
const revenuecatService = require('./services/revenuecatService');
const requireUserId = require('./middleware/requireUserId');

const app = express();

// ✅ express.json() MUST be before routes
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0'; // ✅ MUST bind to 0.0.0.0 for Railway
const PROVIDER = (process.env.PROVIDER || 'openrouter').toLowerCase();
const MODEL = process.env.MODEL || 'openai/gpt-4o-mini';

const PLAN_JSON_SCHEMA = `
You are generating a PLAN for a productivity app.

You must output ONLY valid JSON.  
No explanation. No markdown. No text. No emojis.

Schema:
{
  "title": string,
  "type": "fitness" | "study" | "focus" | "custom",
  "durationDays": number,
  "days": [
    {
      "day": number,
      "tasks": [
        {
          "id": string,
          "title": string,
          "description": string,
          "estimatedMinutes": number
        }
      ]
    }
  ]
}

Rules:
- days.length MUST equal durationDays
- Every day must have 3–7 tasks
- estimatedMinutes must be between 5 and 90
- If you cannot produce valid JSON, output EXACTLY: INVALID
`;

// ✅ Log on server startup
console.log('🚀 MOTI Proxy Server Starting...');
console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔌 Port: ${PORT}`);
console.log(`🤖 Provider: ${PROVIDER}`);
console.log(`🧠 Model: ${MODEL}`);
console.log(`🔑 OpenRouter API Key: ${process.env.OPENROUTER_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`💎 RevenueCat API Key: ${process.env.REVENUECAT_SECRET_KEY ? '✅ Set' : '❌ Missing'}`);

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

// ✅ Main chat endpoint - forward to OpenRouter (free chat or plan chat)
app.post('/moti/chat', async (req, res) => {
  console.log(`[${new Date().toISOString()}] POST /moti/chat`);
  
  try {
    const { mode, planId, message, userId } = req.body;
    
    // Backward compatibility: if mode not provided, default to "plan"
    const chatMode = mode || 'plan';
    
    // Validate message
    if (!message || !message.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'empty_message',
      });
    }
    
    // Validation: if mode === "plan", planId is REQUIRED
    if (chatMode === 'plan') {
      if (!planId) {
        return res.status(400).json({
          ok: false,
          error: 'plan_id_required',
          message: 'planId is required when mode is "plan"',
        });
      }
    }
    
    // Load plan context only for "plan" mode
    let planContext = null;
    if (chatMode === 'plan' && userId && planId) {
      planContext = planService.getPlanContext(userId, planId);
      if (!planContext) {
        return res.status(404).json({
          ok: false,
          error: 'plan_not_found',
        });
      }
    }
    
    // Log request
    console.log(`[AI] mode=${chatMode} userId=${userId || 'null'} planId=${planId || 'null'}`);
    
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('❌ OPENROUTER_API_KEY not set');
      return res.status(500).json({
        ok: false,
        error: 'api_key_missing',
      });
    }

    // ✅ OPENROUTER
    if (PROVIDER === 'openrouter') {
      const startTime = Date.now();
      
      // Build messages based on mode
      let messages;
      if (chatMode === 'free') {
        messages = [
          { role: 'system', content: 'You are NATI, a friendly and helpful AI assistant.' },
          { role: 'user', content: message }
        ];
      } else {
        messages = [
          { role: 'system', content: PLAN_JSON_SCHEMA },
          { role: 'user', content: message }
        ];
      }
      
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: MODEL,
          messages,
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
      
      const aiText = response.data?.choices?.[0]?.message?.content;
      
      if (!aiText) {
        console.error('❌ No reply in OpenRouter response:', JSON.stringify(response.data));
        return res.status(500).json({
          ok: false,
          error: 'no_reply',
        });
      }

      console.log('[AI_RAW]', aiText);

      // Harden JSON parsing for plan mode
      if (chatMode === 'plan') {
        const trimmedText = aiText.trim();
        
        if (trimmedText === 'INVALID') {
          return res.status(422).json({
            ok: false,
            error: 'AI_INVALID_PLAN',
          });
        }

        let plan;
        try {
          plan = JSON.parse(trimmedText);
        } catch (e) {
          console.error('PLAN_JSON_PARSE_FAILED', trimmedText);
          return res.status(422).json({
            ok: false,
            error: 'PLAN_JSON_PARSE_FAILED',
          });
        }

        // Return the parsed JSON as reply (stringified to maintain { reply: string } format)
        return res.json({
          reply: JSON.stringify(plan),
        });
      }

      // Free mode: return text as-is
      return res.json({
        reply: aiText.trim(),
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
app.get('/plans', requireUserId, (req, res) => {
  const userId = req.userId;
  console.log(`[${new Date().toISOString()}] GET /plans for user ${userId}`);
  
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
app.post('/plans', requireUserId, async (req, res) => {
  const userId = req.userId;
  const { name, type, tasks, metadata } = req.body;
  
  console.log(`[${new Date().toISOString()}] POST /plans for user ${userId}`);
  
  try {
    // ✅ Check premium status server-side
    const isPremium = await revenuecatService.isUserPremium(userId);
    const userTier = isPremium ? 'premium' : 'free';
    
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

// ✅ GET /weekly-report - Generate weekly AI report
app.get('/weekly-report', requireUserId, async (req, res) => {
  const userId = req.userId;
  
  console.log(`[${new Date().toISOString()}] GET /weekly-report for user ${userId}`);
  
  try {
    // Check premium status server-side
    const isPremium = await revenuecatService.isUserPremium(userId);
    
    const startTime = Date.now();
    const metrics = weeklyReportService.generateWeeklyReport(userId);
    const generationTime = Date.now() - startTime;
    
    console.log(`📊 Weekly report metrics computed for user ${userId} (${generationTime}ms)`);
    console.log(`   Week range: ${metrics.weekRange.start} to ${metrics.weekRange.end}`);
    console.log(`   Active days: ${metrics.global.activeDays}/7`);
    
    // If not premium, return summary only
    if (!isPremium) {
      return res.json({
        activeDays: metrics.global.activeDays,
        perfectDays: metrics.global.perfectDays,
        missedDays: metrics.global.missedDays,
        teaser: true,
      });
    }
    
    // Premium users get full analysis with AI report
    let aiReport = null;
    
    try {
      if (!process.env.OPENROUTER_API_KEY) {
        console.warn('⚠️ OPENROUTER_API_KEY not set, skipping AI report generation');
      } else {
        console.log(`🤖 Generating AI report for premium user ${userId}...`);
        const aiStartTime = Date.now();
        
        // Prepare context for AI (statistics only, no raw task lists)
        const aiContext = {
          weekRange: metrics.weekRange,
          global: metrics.global,
          plans: metrics.plans.map(p => ({
            planName: p.planName,
            planType: p.planType,
            completionRate: p.completionRate,
            daysActive: p.daysActive,
            daysMissed: p.daysMissed,
            streak: p.streak,
            bestDayOfWeek: p.bestDayOfWeek,
            worstDayOfWeek: p.worstDayOfWeek,
          })),
          patterns: metrics.patterns,
        };
        
        const MODEL = process.env.MODEL || 'openai/gpt-4o-mini';
        
        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model: MODEL,
            messages: [
              {
                role: 'system',
                content: 'You are NATI, a supportive productivity and life coach. Analyze the user\'s last 7 days. Be honest, kind, and actionable. Do not shame. Provide encouragement, insight, and 3 concrete improvements for next week.',
              },
              {
                role: 'user',
                content: JSON.stringify(aiContext, null, 2),
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
        
        const aiDuration = Date.now() - aiStartTime;
        aiReport = response.data?.choices?.[0]?.message?.content?.trim();
        
        if (aiReport) {
          console.log(`✅ AI report generated for user ${userId} (${aiDuration}ms, ${aiReport.length} chars)`);
        } else {
          console.warn('⚠️ Empty AI response, continuing without AI report');
        }
      }
    } catch (aiError) {
      // Don't fail the request if AI fails
      console.error(`❌ AI report generation failed for user ${userId}:`, aiError.message);
      // Continue without AI report
    }
    
    // Prepare plans summary
    const plansSummary = metrics.plans.map(p => ({
      planId: p.planId,
      planName: p.planName,
      completionRate: p.completionRate,
      daysActive: p.daysActive,
      streak: p.streak,
    }));
    
    return res.json({
      metrics: {
        global: metrics.global,
        weekRange: metrics.weekRange,
      },
      aiReport,
      plansSummary,
      patterns: metrics.patterns,
    });
  } catch (err) {
    console.error(`❌ Error generating weekly report:`, err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      details: err.message,
    });
  }
});
console.log('✅ Registered: GET /weekly-report');

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
  console.log('📊 Weekly Report Endpoints:');
  console.log(`   GET    /weekly-report - Get weekly AI report`);
  console.log('');
  console.log('✅ Server ready!');
});
