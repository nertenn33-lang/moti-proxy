/**
 * PlanService - Single Source of Truth for NATI Plan System
 * 
 * Each plan is a professional coach with:
 * - Its own calendar
 * - Its own day index
 * - Its own progress
 * - Its own notifications
 * - Its own AI context
 */

// In-memory storage (replace with database in production)
const plansStore = new Map(); // userId -> Array of plans

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a plan should advance to the next day
 * Day only advances when: todayDate > plan.lastProcessedDate
 * And only once per calendar day.
 */
function shouldAdvanceDay(plan) {
  const todayDate = getTodayDate();
  return todayDate > plan.lastProcessedDate;
}

/**
 * Process day rollover for a plan
 * Advances day only if date has changed
 */
function processDayRollover(plan) {
  const todayDate = getTodayDate();
  
  if (shouldAdvanceDay(plan)) {
    console.log(`📅 Advancing plan ${plan.id} from day ${plan.currentDay} to ${plan.currentDay + 1}`);
    plan.currentDay += 1;
    plan.lastProcessedDate = todayDate;
    
    // Reset tasks for new day
    if (plan.tasks) {
      plan.tasks.forEach(task => {
        task.completed = false;
      });
    }
    
    return true; // Day advanced
  }
  
  return false; // No advancement
}

/**
 * Get all plans for a user
 */
function getUserPlans(userId) {
  const userPlans = plansStore.get(userId) || [];
  
  // Process day rollover for each plan
  userPlans.forEach(plan => {
    processDayRollover(plan);
  });
  
  return userPlans;
}

/**
 * Get a specific plan by ID
 */
function getPlanById(userId, planId) {
  const userPlans = plansStore.get(userId) || [];
  const plan = userPlans.find(p => p.id === planId);
  
  if (plan) {
    processDayRollover(plan);
  }
  
  return plan;
}

/**
 * Check subscription limits
 * Free: 1 plan max
 * Premium: Unlimited
 */
function canCreatePlan(userId, userTier = 'free') {
  const userPlans = getUserPlans(userId);
  
  if (userTier === 'premium') {
    return { canCreate: true, reason: null };
  }
  
  if (userTier === 'free' && userPlans.length >= 1) {
    return {
      canCreate: false,
      reason: 'free_limit_reached',
      message: 'Free users can only have 1 plan. Upgrade to Premium for unlimited plans.',
    };
  }
  
  return { canCreate: true, reason: null };
}

/**
 * Create a new plan
 */
function createPlan(userId, planData) {
  const todayDate = getTodayDate();
  
  const plan = {
    id: `${userId}-${Date.now()}`,
    userId,
    name: planData.name || 'Untitled Plan',
    type: planData.type || 'general', // fitness, study, life, etc.
    currentDay: 1,
    lastProcessedDate: todayDate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: planData.tasks || [],
    metadata: planData.metadata || {},
  };
  
  const userPlans = plansStore.get(userId) || [];
  userPlans.push(plan);
  plansStore.set(userId, userPlans);
  
  console.log(`✅ Created plan ${plan.id} for user ${userId}`);
  return plan;
}

/**
 * Update a plan
 */
function updatePlan(userId, planId, updates) {
  const userPlans = plansStore.get(userId) || [];
  const planIndex = userPlans.findIndex(p => p.id === planId);
  
  if (planIndex === -1) {
    return null;
  }
  
  const plan = userPlans[planIndex];
  
  // Don't allow direct modification of currentDay or lastProcessedDate
  // These are managed by day rollover logic
  const allowedUpdates = {
    name: updates.name,
    type: updates.type,
    tasks: updates.tasks,
    metadata: updates.metadata,
  };
  
  Object.assign(plan, {
    ...allowedUpdates,
    updatedAt: new Date().toISOString(),
  });
  
  userPlans[planIndex] = plan;
  plansStore.set(userId, userPlans);
  
  return plan;
}

/**
 * Complete a task
 * This does NOT advance the day
 */
function completeTask(userId, planId, taskId) {
  const plan = getPlanById(userId, planId);
  
  if (!plan) {
    return null;
  }
  
  if (!plan.tasks) {
    plan.tasks = [];
  }
  
  const task = plan.tasks.find(t => t.id === taskId);
  if (!task) {
    return null;
  }
  
  task.completed = true;
  task.completedAt = new Date().toISOString();
  
  plan.updatedAt = new Date().toISOString();
  
  // Update plan in store
  const userPlans = plansStore.get(userId) || [];
  const planIndex = userPlans.findIndex(p => p.id === planId);
  if (planIndex !== -1) {
    userPlans[planIndex] = plan;
    plansStore.set(userId, userPlans);
  }
  
  return plan;
}

/**
 * Get today's tasks for a plan
 */
function getTodayTasks(plan) {
  processDayRollover(plan);
  return plan.tasks || [];
}

/**
 * Get completion status for a plan
 */
function getCompletionStatus(plan) {
  const tasks = getTodayTasks(plan);
  if (tasks.length === 0) {
    return { completed: 0, total: 0, percentage: 0 };
  }
  
  const completed = tasks.filter(t => t.completed).length;
  const total = tasks.length;
  const percentage = Math.round((completed / total) * 100);
  
  return { completed, total, percentage };
}

/**
 * Get plan context for AI requests
 */
function getPlanContext(userId, planId) {
  const plan = getPlanById(userId, planId);
  
  if (!plan) {
    return null;
  }
  
  const todayTasks = getTodayTasks(plan);
  const completionStatus = getCompletionStatus(plan);
  
  return {
    userId,
    planId: plan.id,
    planName: plan.name,
    planType: plan.type,
    currentDay: plan.currentDay,
    lastProcessedDate: plan.lastProcessedDate,
    todayTasks: todayTasks.map(t => ({
      id: t.id,
      title: t.title,
      completed: t.completed,
    })),
    completionStatus,
  };
}

/**
 * Delete a plan
 */
function deletePlan(userId, planId) {
  const userPlans = plansStore.get(userId) || [];
  const filtered = userPlans.filter(p => p.id !== planId);
  
  if (filtered.length === userPlans.length) {
    return false; // Plan not found
  }
  
  plansStore.set(userId, filtered);
  return true;
}

/**
 * Fill plan with days data (used after AI generation)
 * @param {string} userId - User ID
 * @param {string} planId - Plan ID
 * @param {Object} daysData - Object with days array
 * @returns {Object|null} Updated plan or null if not found
 */
function fillPlan(userId, planId, daysData) {
  const userPlans = plansStore.get(userId) || [];
  const planIndex = userPlans.findIndex(p => p.id === planId);
  
  if (planIndex === -1) {
    return null; // Plan not found
  }
  
  const plan = userPlans[planIndex];
  const todayDate = getTodayDate();
  
  // Replace plan.days with provided days
  plan.days = daysData.days || [];
  
  // Set currentDay = 1
  plan.currentDay = 1;
  
  // Set lastProcessedDate = today
  plan.lastProcessedDate = todayDate;
  
  // Update updatedAt timestamp
  plan.updatedAt = new Date().toISOString();
  
  // Save back to store
  userPlans[planIndex] = plan;
  plansStore.set(userId, userPlans);
  
  console.log(`✅ Filled plan ${planId} with ${plan.days.length} day(s)`);
  return plan;
}

module.exports = {
  getUserPlans,
  getPlanById,
  canCreatePlan,
  createPlan,
  updatePlan,
  completeTask,
  getTodayTasks,
  getCompletionStatus,
  getPlanContext,
  deletePlan,
  fillPlan,
  processDayRollover,
  shouldAdvanceDay,
  getTodayDate,
};

