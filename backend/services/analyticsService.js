/**
 * Analytics Service
 * Tracks API usage, costs, response times, success/failure rates
 * Monitors cache effectiveness and generates usage reports
 */
class AnalyticsService {
  constructor() {
    this.metrics = {
      apiCalls: {},
      responseTimes: {},
      successRates: {},
      errorTypes: {},
      promptPatterns: {},
      cacheStats: {
        hits: 0,
        misses: 0,
      },
      totalCost: 0,
    };

    // API cost per call (in USD, for paid APIs)
    this.apiCosts = {
      gemini: 0.00025, // per request (estimated)
      mapbox: 0.0005, // per tile request
      mapillary: 0, // free
      sketchfab: 0, // free
      wikipedia: 0, // free
      wikidata: 0, // free
      wikimedia: 0, // free
      openstreetmap: 0, // free
      'open-elevation': 0, // free
      'open-meteo': 0, // free
    };

    this.startTime = Date.now();
  }

  /**
   * Track API call
   */
  trackAPICall(apiName, duration, success, error = null) {
    const api = apiName.toLowerCase();

    // Initialize metrics for this API if not exists
    if (!this.metrics.apiCalls[api]) {
      this.metrics.apiCalls[api] = 0;
      this.metrics.responseTimes[api] = [];
      this.metrics.successRates[api] = { success: 0, failure: 0 };
      this.metrics.errorTypes[api] = {};
    }

    // Track call count
    this.metrics.apiCalls[api]++;

    // Track response time
    this.metrics.responseTimes[api].push(duration);

    // Track success/failure
    if (success) {
      this.metrics.successRates[api].success++;
    } else {
      this.metrics.successRates[api].failure++;
      
      // Track error type
      const errorType = error?.type || error?.message || 'unknown';
      if (!this.metrics.errorTypes[api][errorType]) {
        this.metrics.errorTypes[api][errorType] = 0;
      }
      this.metrics.errorTypes[api][errorType]++;
    }

    // Track cost
    const cost = this.apiCosts[api] || 0;
    this.metrics.totalCost += cost;

    console.log(`📊 Analytics: ${api} - ${success ? '✅' : '❌'} - ${duration}ms - $${cost.toFixed(6)}`);
  }

  /**
   * Track user prompt pattern
   */
  trackPromptPattern(prompt, detectedIntent) {
    const pattern = detectedIntent?.type || 'generic';
    
    if (!this.metrics.promptPatterns[pattern]) {
      this.metrics.promptPatterns[pattern] = 0;
    }
    
    this.metrics.promptPatterns[pattern]++;
  }

  /**
   * Track cache performance
   */
  trackCache(hit) {
    if (hit) {
      this.metrics.cacheStats.hits++;
    } else {
      this.metrics.cacheStats.misses++;
    }
  }

  /**
   * Get average response time for an API
   */
  getAverageResponseTime(apiName) {
    const times = this.metrics.responseTimes[apiName.toLowerCase()];
    if (!times || times.length === 0) {
      return 0;
    }
    
    const sum = times.reduce((a, b) => a + b, 0);
    return Math.round(sum / times.length);
  }

  /**
   * Get success rate for an API
   */
  getSuccessRate(apiName) {
    const rates = this.metrics.successRates[apiName.toLowerCase()];
    if (!rates) {
      return 0;
    }
    
    const total = rates.success + rates.failure;
    if (total === 0) {
      return 0;
    }
    
    return (rates.success / total * 100).toFixed(2);
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate() {
    const total = this.metrics.cacheStats.hits + this.metrics.cacheStats.misses;
    if (total === 0) {
      return 0;
    }
    
    return (this.metrics.cacheStats.hits / total * 100).toFixed(2);
  }

  /**
   * Generate comprehensive usage report
   */
  generateReport() {
    const uptime = Date.now() - this.startTime;
    const uptimeHours = (uptime / (1000 * 60 * 60)).toFixed(2);

    const report = {
      summary: {
        uptime: `${uptimeHours} hours`,
        totalCost: `$${this.metrics.totalCost.toFixed(4)}`,
        cacheHitRate: `${this.getCacheHitRate()}%`,
      },
      apis: {},
      promptPatterns: this.metrics.promptPatterns,
      topErrors: this.getTopErrors(),
    };

    // Generate report for each API
    for (const api of Object.keys(this.metrics.apiCalls)) {
      report.apis[api] = {
        calls: this.metrics.apiCalls[api],
        avgResponseTime: `${this.getAverageResponseTime(api)}ms`,
        successRate: `${this.getSuccessRate(api)}%`,
        cost: `$${(this.metrics.apiCalls[api] * (this.apiCosts[api] || 0)).toFixed(4)}`,
      };
    }

    return report;
  }

  /**
   * Get top errors across all APIs
   */
  getTopErrors(limit = 5) {
    const allErrors = [];
    
    for (const [api, errorTypes] of Object.entries(this.metrics.errorTypes)) {
      for (const [errorType, count] of Object.entries(errorTypes)) {
        allErrors.push({ api, errorType, count });
      }
    }

    return allErrors
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get most popular prompt patterns
   */
  getPopularPatterns(limit = 5) {
    return Object.entries(this.metrics.promptPatterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([pattern, count]) => ({ pattern, count }));
  }

  /**
   * Get API health status
   */
  getAPIHealth() {
    const health = {};
    
    for (const api of Object.keys(this.metrics.apiCalls)) {
      const successRate = parseFloat(this.getSuccessRate(api));
      const avgResponseTime = this.getAverageResponseTime(api);
      
      let status = 'healthy';
      if (successRate < 80) {
        status = 'degraded';
      }
      if (successRate < 50 || avgResponseTime > 10000) {
        status = 'unhealthy';
      }
      
      health[api] = {
        status,
        successRate: `${successRate}%`,
        avgResponseTime: `${avgResponseTime}ms`,
      };
    }
    
    return health;
  }

  /**
   * Reset metrics (useful for testing)
   */
  reset() {
    this.metrics = {
      apiCalls: {},
      responseTimes: {},
      successRates: {},
      errorTypes: {},
      promptPatterns: {},
      cacheStats: {
        hits: 0,
        misses: 0,
      },
      totalCost: 0,
    };
    this.startTime = Date.now();
    console.log('Analytics metrics reset');
  }

  /**
   * Export metrics for external analysis
   */
  exportMetrics() {
    return {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      metrics: this.metrics,
      report: this.generateReport(),
    };
  }
}

// Export singleton instance
module.exports = new AnalyticsService();
