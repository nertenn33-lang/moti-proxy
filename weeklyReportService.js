/**
 * Weekly Report Service
 * Analyzes user's last 7 days of plan activity and generates AI reports
 */

const planService = require('./planService');

// Cache for weekly reports (userId:weekRange -> { data, timestamp })
// Cache key includes weekRange so it rotates correctly each week
const reportCache = new Map();

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Get today's date in Europe/Istanbul timezone (YYYY-MM-DD format)
 */
function getTodayDateIstanbul() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

/**
 * Subtract days from a date string (YYYY-MM-DD format)
 * Works with calendar days, properly handling month/year boundaries
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {number} days - Number of days to subtract
 * @returns {string} Date string in YYYY-MM-DD format
 */
function subtractDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Create date object (using local time, but we'll format in Istanbul)
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - days);
  
  // Format in Istanbul timezone to get correct calendar date
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

/**
 * Get date range for last 7 calendar days (today - 6 days to today)
 * Returns array of dates in YYYY-MM-DD format (Europe/Istanbul timezone)
 */
function getLast7Days() {
  const days = [];
  const today = getTodayDateIstanbul();
  
  // Calculate dates: today - 6 days to today (7 days total)
  for (let i = 6; i >= 0; i--) {
    const date = subtractDays(today, 6 - i);
    days.push(date);
  }
  
  return days;
}

/**
 * Get week range (start = today - 6 days, end = today)
 * Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } in Europe/Istanbul timezone
 */
function getWeekRange() {
  const end = getTodayDateIstanbul();
  const start = subtractDays(end, 6);
  
  return { start, end };
}

/**
 * Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 */
function getDayOfWeek(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.getDay();
}

/**
 * Get day name from day of week
 */
function getDayName(dayOfWeek) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek];
}

/**
 * Analyze a single plan for the last 7 days
 * Uses plan advancement (currentDay, lastProcessedDate) and current task state
 */
function analyzePlan(plan, dateRange) {
  const today = planService.getTodayDate();
  const planData = {
    planId: plan.id,
    planName: plan.name,
    planType: plan.type,
    currentDay: plan.currentDay,
    lastProcessedDate: plan.lastProcessedDate,
  };
  
  const tasks = plan.tasks || [];
  const totalTasksPerDay = tasks.length;
  const createdAt = new Date(plan.createdAt);
  
  // Track activity per day
  const dayActivity = {};
  dateRange.forEach(date => {
    const dateObj = new Date(date + 'T00:00:00');
    const isInRange = dateObj >= createdAt && date <= today;
    const isBeforeLastProcessed = date <= plan.lastProcessedDate;
    
    dayActivity[date] = {
      date,
      dayOfWeek: getDayOfWeek(date),
      completedTasks: 0,
      totalTasks: totalTasksPerDay,
      isActive: false,
      isPerfect: false,
    };
    
    // Mark as active if plan existed and was processed on or before this date
    if (isInRange && isBeforeLastProcessed) {
      dayActivity[date].isActive = true;
      // Assume tasks were completed if the plan advanced (since day advanced)
      dayActivity[date].completedTasks = totalTasksPerDay;
      dayActivity[date].isPerfect = totalTasksPerDay > 0;
    }
    
    // For today, use actual task completion state
    if (date === today && isInRange) {
      const completedCount = tasks.filter(t => t.completed).length;
      dayActivity[date].completedTasks = completedCount;
      dayActivity[date].isActive = completedCount > 0;
      dayActivity[date].isPerfect = completedCount === totalTasksPerDay && totalTasksPerDay > 0;
    }
  });
  
  // Calculate metrics
  const activeDays = Object.values(dayActivity).filter(d => d.isActive).length;
  const daysMissed = 7 - activeDays;
  
  // Calculate completion rate (based on current state)
  const currentCompleted = tasks.filter(t => t.completed).length;
  const completionRate = totalTasksPerDay > 0 
    ? currentCompleted / totalTasksPerDay 
    : 0;
  
  // Count activity by day of week
  const dayOfWeekCounts = {};
  Object.values(dayActivity).forEach(day => {
    if (day.isActive) {
      const dow = day.dayOfWeek;
      dayOfWeekCounts[dow] = (dayOfWeekCounts[dow] || 0) + 1;
    }
  });
  
  // Find best and worst day of week
  let bestDayOfWeek = null;
  let worstDayOfWeek = null;
  let maxCount = -1;
  let minCount = Infinity;
  
  Object.entries(dayOfWeekCounts).forEach(([day, count]) => {
    if (count > maxCount) {
      maxCount = count;
      bestDayOfWeek = parseInt(day);
    }
    if (count < minCount) {
      minCount = count;
      worstDayOfWeek = parseInt(day);
    }
  });
  
  // Calculate streak (consecutive active days from today backwards)
  let streak = 0;
  for (let i = dateRange.length - 1; i >= 0; i--) {
    if (dayActivity[dateRange[i]].isActive) {
      streak++;
    } else {
      break;
    }
  }
  
  return {
    ...planData,
    completionRate: Math.round(completionRate * 100) / 100,
    daysActive: activeDays,
    daysMissed,
    bestDayOfWeek: bestDayOfWeek !== null ? getDayName(bestDayOfWeek) : null,
    worstDayOfWeek: worstDayOfWeek !== null ? getDayName(worstDayOfWeek) : null,
    streak,
    dayActivity: Object.values(dayActivity),
  };
}

/**
 * Compute all metrics for a user's weekly report
 */
function computeMetrics(userId) {
  const plans = planService.getUserPlans(userId);
  const dateRange = getLast7Days();
  const weekRange = getWeekRange();
  
  // Analyze each plan
  const planAnalyses = plans.map(plan => analyzePlan(plan, dateRange));
  
  // Compute global metrics
  const globalActivity = {};
  dateRange.forEach(date => {
    globalActivity[date] = {
      date,
      dayOfWeek: getDayOfWeek(date),
      completedTasks: 0,
      totalTasks: 0,
      activePlans: 0,
      perfectPlans: 0,
    };
  });
  
  // Aggregate across all plans
  planAnalyses.forEach(analysis => {
    analysis.dayActivity.forEach(day => {
      const globalDay = globalActivity[day.date];
      globalDay.completedTasks += day.completedTasks;
      globalDay.totalTasks += day.totalTasks;
      if (day.isActive) {
        globalDay.activePlans++;
      }
      if (day.isPerfect) {
        globalDay.perfectPlans++;
      }
    });
  });
  
  const globalDays = Object.values(globalActivity);
  const activeDays = globalDays.filter(d => d.completedTasks > 0).length;
  const perfectDays = globalDays.filter(d => 
    d.totalTasks > 0 && d.completedTasks === d.totalTasks
  ).length;
  const partialDays = globalDays.filter(d => 
    d.completedTasks > 0 && d.completedTasks < d.totalTasks
  ).length;
  const missedDays = globalDays.filter(d => d.completedTasks === 0).length;
  
  // Find patterns
  const dayOfWeekActivity = {};
  globalDays.forEach(day => {
    const dow = day.dayOfWeek;
    if (!dayOfWeekActivity[dow]) {
      dayOfWeekActivity[dow] = { completed: 0, total: 0, count: 0 };
    }
    dayOfWeekActivity[dow].completed += day.completedTasks;
    dayOfWeekActivity[dow].total += day.totalTasks;
    dayOfWeekActivity[dow].count += 1;
  });
  
  let bestDayOfWeek = null;
  let worstDayOfWeek = null;
  let bestRate = -1;
  let worstRate = Infinity;
  
  Object.entries(dayOfWeekActivity).forEach(([dow, stats]) => {
    const rate = stats.total > 0 ? stats.completed / stats.total : 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestDayOfWeek = parseInt(dow);
    }
    if (rate < worstRate) {
      worstRate = rate;
      worstDayOfWeek = parseInt(dow);
    }
  });
  
  // Find most consistent and most skipped plans
  let mostConsistentPlan = null;
  let mostSkippedPlan = null;
  let maxConsistency = -1;
  let maxSkipped = -1;
  
  planAnalyses.forEach(plan => {
    const consistencyRate = plan.daysActive / 7;
    if (consistencyRate > maxConsistency) {
      maxConsistency = consistencyRate;
      mostConsistentPlan = plan.planId;
    }
    if (plan.daysMissed > maxSkipped) {
      maxSkipped = plan.daysMissed;
      mostSkippedPlan = plan.planId;
    }
  });
  
  // Find typical drop-off day
  // Look for patterns where activity decreases after a certain day
  let typicalDropOffDay = null;
  let maxDropOff = 0;
  
  for (let i = 0; i < globalDays.length - 1; i++) {
    const currentActive = globalDays[i].completedTasks;
    const nextActive = globalDays[i + 1].completedTasks;
    const dropOff = currentActive - nextActive;
    
    if (dropOff > maxDropOff && currentActive > 0) {
      maxDropOff = dropOff;
      typicalDropOffDay = i + 1; // Day index (1-based)
    }
  }
  
  return {
    weekRange,
    global: {
      totalDays: 7,
      activeDays,
      perfectDays,
      partialDays,
      missedDays,
    },
    plans: planAnalyses.map(p => ({
      planId: p.planId,
      planName: p.planName,
      planType: p.planType,
      completionRate: p.completionRate,
      daysActive: p.daysActive,
      daysMissed: p.daysMissed,
      bestDayOfWeek: p.bestDayOfWeek,
      worstDayOfWeek: p.worstDayOfWeek,
      streak: p.streak,
    })),
    patterns: {
      mostConsistentPlan: mostConsistentPlan ? planAnalyses.find(p => p.planId === mostConsistentPlan)?.planName : null,
      mostSkippedPlan: mostSkippedPlan ? planAnalyses.find(p => p.planId === mostSkippedPlan)?.planName : null,
      bestDayOfWeek: bestDayOfWeek !== null ? getDayName(bestDayOfWeek) : null,
      worstDayOfWeek: worstDayOfWeek !== null ? getDayName(worstDayOfWeek) : null,
      typicalDropOffDay: typicalDropOffDay,
    },
  };
}

/**
 * Get cache key for a user and weekRange
 */
function getCacheKey(userId, weekRange) {
  return `${userId}:${weekRange.start}:${weekRange.end}`;
}

/**
 * Get cached report or compute new one
 */
function getCachedReport(userId, weekRange) {
  const cacheKey = getCacheKey(userId, weekRange);
  const cached = reportCache.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      return cached.data;
    }
    // Expired, remove from cache
    reportCache.delete(cacheKey);
  }
  return null;
}

/**
 * Cache a report
 */
function cacheReport(userId, weekRange, data) {
  const cacheKey = getCacheKey(userId, weekRange);
  reportCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Generate weekly report metrics
 */
function generateWeeklyReport(userId) {
  // Compute weekRange first (used for cache key)
  const weekRange = getWeekRange();
  
  // Check cache first
  const cached = getCachedReport(userId, weekRange);
  if (cached) {
    return cached;
  }
  
  // Compute metrics
  const metrics = computeMetrics(userId);
  
  // Cache the result (using weekRange from metrics to ensure consistency)
  cacheReport(userId, metrics.weekRange, metrics);
  
  return metrics;
}

module.exports = {
  generateWeeklyReport,
  computeMetrics,
  getLast7Days,
  getWeekRange,
  getTodayDateIstanbul,
};

