const fs = require('fs').promises;
const path = require('path');
const config = require('../config/ai3d-providers');

/**
 * Credit Manager Service
 * Tracks API credit usage across all AI 3D generation providers
 * Monitors free tier limits, budget alerts, and cost analytics
 */
class CreditManager {
  constructor() {
    this.creditFilePath = path.join(__dirname, '../db/creditUsage.json');
    this.config = config;
    this.cache = null;
    this.lastLoad = null;
  }

  /**
   * Load credit usage data from disk
   */
  async loadCredits() {
    try {
      // Use cached data if loaded recently (< 5 seconds ago)
      if (this.cache && this.lastLoad && (Date.now() - this.lastLoad < 5000)) {
        return this.cache;
      }

      const data = await fs.readFile(this.creditFilePath, 'utf8');
      this.cache = JSON.parse(data);
      this.lastLoad = Date.now();

      // Check if we need to reset monthly credits
      await this.checkMonthlyReset();

      return this.cache;
    } catch (error) {
      console.error('Error loading credits:', error);
      // Return default structure if file doesn't exist
      return this.getDefaultCredits();
    }
  }

  /**
   * Save credit usage data to disk
   */
  async saveCredits(data) {
    try {
      await fs.writeFile(this.creditFilePath, JSON.stringify(data, null, 2), 'utf8');
      this.cache = data;
      this.lastLoad = Date.now();
    } catch (error) {
      console.error('Error saving credits:', error);
      throw error;
    }
  }

  /**
   * Get default credit structure
   */
  getDefaultCredits() {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      currentMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      resetDate: nextMonth.toISOString(),
      providers: {
        tripo: {
          used: 0,
          free: config.tripo.freeTier.monthly,
        },
        meshy: {
          used: 0,
          free: config.meshy.freeTier.monthly,
        },
        vertexImagen: {
          used: 0,
          free: config.vertexImagen.freeTier.monthly,
        },
      },
      totalCost: 0,
      generationsCount: 0,
      cacheHits: 0,
      history: [],
    };
  }

  /**
   * Check if we need to reset monthly credits
   */
  async checkMonthlyReset() {
    const credits = this.cache || await this.loadCredits();
    const now = new Date();
    const resetDate = new Date(credits.resetDate);

    if (now >= resetDate) {
      console.log('🔄 Resetting monthly credits...');
      const newCredits = this.getDefaultCredits();
      // Preserve history
      newCredits.history = credits.history || [];
      await this.saveCredits(newCredits);
      return true;
    }

    return false;
  }

  /**
   * Get current credit status for all providers
   */
  async getCreditStatus() {
    const credits = await this.loadCredits();

    return {
      tripo: {
        free: credits.providers.tripo.free,
        used: credits.providers.tripo.used,
        remaining: credits.providers.tripo.free - credits.providers.tripo.used,
        percentUsed: (credits.providers.tripo.used / credits.providers.tripo.free) * 100,
      },
      meshy: {
        free: credits.providers.meshy.free,
        used: credits.providers.meshy.used,
        remaining: credits.providers.meshy.free - credits.providers.meshy.used,
        percentUsed: (credits.providers.meshy.used / credits.providers.meshy.free) * 100,
      },
      vertexImagen: {
        free: credits.providers.vertexImagen.free,
        used: credits.providers.vertexImagen.used,
        remaining: credits.providers.vertexImagen.free - credits.providers.vertexImagen.used,
        percentUsed: (credits.providers.vertexImagen.used / credits.providers.vertexImagen.free) * 100,
      },
      budget: {
        max: config.budget.maxMonthlyUSD,
        used: credits.totalCost,
        remaining: config.budget.maxMonthlyUSD - credits.totalCost,
        percentUsed: (credits.totalCost / config.budget.maxMonthlyUSD) * 100,
      },
      resetDate: credits.resetDate,
    };
  }

  /**
   * Check if we can use a provider's free tier
   */
  async canUseFreeTier(provider, creditsNeeded) {
    const credits = await this.loadCredits();
    const providerData = credits.providers[provider];

    if (!providerData) {
      return false;
    }

    const remaining = providerData.free - providerData.used;
    return remaining >= creditsNeeded;
  }

  /**
   * Check if we're within budget
   */
  async isWithinBudget(estimatedCost) {
    const credits = await this.loadCredits();
    const newTotal = credits.totalCost + estimatedCost;
    const budgetPercent = (newTotal / config.budget.maxMonthlyUSD) * 100;

    return {
      withinBudget: budgetPercent < config.budget.stopAtPercent,
      budgetPercent,
      shouldAlert: budgetPercent >= config.budget.alertAtPercent,
      remaining: config.budget.maxMonthlyUSD - newTotal,
    };
  }

  /**
   * Record credit usage for a generation
   */
  async recordUsage(provider, creditsUsed, costUSD, metadata = {}) {
    const credits = await this.loadCredits();

    // Update provider credits
    if (credits.providers[provider]) {
      credits.providers[provider].used += creditsUsed;
    }

    // Update total cost
    credits.totalCost += costUSD;

    // Update generation count
    credits.generationsCount += 1;

    // Add to history
    const historyEntry = {
      timestamp: new Date().toISOString(),
      provider,
      creditsUsed,
      costUSD,
      ...metadata,
    };

    credits.history.push(historyEntry);

    // Keep only last 1000 entries
    if (credits.history.length > 1000) {
      credits.history = credits.history.slice(-1000);
    }

    await this.saveCredits(credits);

    // Check for budget alerts
    const budgetCheck = await this.isWithinBudget(0);
    if (budgetCheck.shouldAlert) {
      console.warn(`⚠️  Budget alert: ${budgetCheck.budgetPercent.toFixed(1)}% of monthly budget used`);
    }

    return historyEntry;
  }

  /**
   * Record a cache hit
   */
  async recordCacheHit() {
    const credits = await this.loadCredits();
    credits.cacheHits += 1;
    await this.saveCredits(credits);
  }

  /**
   * Get monthly usage statistics
   */
  async getUsageStats() {
    const credits = await this.loadCredits();
    const status = await this.getCreditStatus();

    const cacheHitRate = credits.generationsCount > 0
      ? credits.cacheHits / (credits.generationsCount + credits.cacheHits)
      : 0;

    const providerUsage = {
      tripo: credits.history.filter(h => h.provider === 'tripo').length,
      meshy: credits.history.filter(h => h.provider === 'meshy').length,
      vertexImagen: credits.history.filter(h => h.provider === 'vertexImagen').length,
      cache: credits.cacheHits,
    };

    return {
      currentMonth: credits.currentMonth,
      resetDate: credits.resetDate,
      totalCost: credits.totalCost,
      generationsCount: credits.generationsCount,
      cacheHits: credits.cacheHits,
      cacheHitRate: cacheHitRate,
      providers: providerUsage,
      budgetStatus: status.budget,
      creditStatus: {
        tripo: status.tripo,
        meshy: status.meshy,
        vertexImagen: status.vertexImagen,
      },
    };
  }

  /**
   * Get cost forecast based on current usage
   */
  async getForecast() {
    const credits = await this.loadCredits();
    const now = new Date();
    const resetDate = new Date(credits.resetDate);
    const daysInMonth = Math.ceil((resetDate - new Date(now.getFullYear(), now.getMonth(), 1)) / (1000 * 60 * 60 * 24));
    const daysPassed = now.getDate();
    const daysRemaining = daysInMonth - daysPassed;

    const avgDailyCost = daysPassed > 0 ? credits.totalCost / daysPassed : 0;
    const projectedMonthlyCost = avgDailyCost * daysInMonth;

    const budgetStatus = projectedMonthlyCost <= config.budget.maxMonthlyUSD ? 'under' : 'over';

    const recommendations = [];
    if (budgetStatus === 'over') {
      recommendations.push('Reduce generation frequency');
      recommendations.push('Use ultra_cheap mode more often');
      recommendations.push('Rely more on cache hits');
    } else {
      recommendations.push('Continue current usage pattern');
    }

    return {
      projectedMonthlyCost,
      currentCost: credits.totalCost,
      budgetStatus,
      daysRemaining,
      avgDailyCost,
      recommendedActions: recommendations,
    };
  }

  /**
   * Get best provider based on free tier availability and cost
   */
  async getBestProvider(mode = 'ultra_cheap') {
    const status = await this.getCreditStatus();
    const modeConfig = config.generationModes[mode];

    if (!modeConfig) {
      throw new Error(`Invalid generation mode: ${mode}`);
    }

    // If free tier first is enabled, check free tier availability
    if (config.features.useFreeTierFirst) {
      // Check each provider in the pipeline
      for (const provider of modeConfig.pipeline) {
        const providerStatus = status[provider];
        if (providerStatus && providerStatus.remaining > 0) {
          return {
            provider,
            useFreeTier: true,
            creditsAvailable: providerStatus.remaining,
            estimatedCost: 0,
          };
        }
      }
    }

    // If no free tier available or not prioritizing free tier, return first provider
    const provider = modeConfig.pipeline[0];
    return {
      provider,
      useFreeTier: false,
      estimatedCost: modeConfig.estimatedCost,
    };
  }
}

module.exports = new CreditManager();
