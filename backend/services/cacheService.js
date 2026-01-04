const fs = require('fs').promises;
const path = require('path');

/**
 * Smart Caching Layer
 * Implements intelligent caching with LRU eviction, persistence, and TTL
 * Different cache strategies for different data types
 */
class CacheService {
  constructor() {
    this.caches = {
      // Long-term cache for rarely changing data (Wikipedia, Wikidata)
      longTerm: new Map(),
      // Medium-term cache for semi-static data (Mapbox tiles, building data)
      mediumTerm: new Map(),
      // Short-term cache for frequently changing data (weather, searches)
      shortTerm: new Map(),
    };

    // Cache configurations (TTL in milliseconds)
    this.config = {
      longTerm: {
        ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
        maxSize: 1000,
      },
      mediumTerm: {
        ttl: 24 * 60 * 60 * 1000, // 1 day
        maxSize: 500,
      },
      shortTerm: {
        ttl: 60 * 60 * 1000, // 1 hour
        maxSize: 200,
      },
    };

    // Cache metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };

    // Cache directory for persistence
    this.cacheDir = path.join(__dirname, '../.cache');
    this.persistenceEnabled = true;

    // Initialize cache directory
    this.initializeCacheDir();
  }

  /**
   * Initialize cache directory for persistence
   */
  async initializeCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      console.log('Cache directory initialized:', this.cacheDir);
    } catch (error) {
      console.error('Failed to initialize cache directory:', error);
      this.persistenceEnabled = false;
    }
  }

  /**
   * Generate cache key from parameters
   */
  generateKey(namespace, params) {
    const paramsStr = typeof params === 'object' 
      ? JSON.stringify(params, Object.keys(params).sort())
      : String(params);
    return `${namespace}:${paramsStr}`;
  }

  /**
   * Get item from cache
   */
  get(cacheType, key) {
    const cache = this.caches[cacheType];
    if (!cache) {
      console.warn(`Invalid cache type: ${cacheType}`);
      return null;
    }

    const item = cache.get(key);
    if (!item) {
      this.metrics.misses++;
      return null;
    }

    const now = Date.now();
    const ttl = this.config[cacheType].ttl;

    // Check if expired
    if (now - item.timestamp > ttl) {
      cache.delete(key);
      this.metrics.misses++;
      return null;
    }

    // Update access time for LRU
    item.lastAccess = now;
    cache.set(key, item);
    this.metrics.hits++;

    console.log(`Cache HIT [${cacheType}]: ${key}`);
    return item.data;
  }

  /**
   * Set item in cache
   */
  set(cacheType, key, data) {
    const cache = this.caches[cacheType];
    if (!cache) {
      console.warn(`Invalid cache type: ${cacheType}`);
      return;
    }

    const now = Date.now();
    const config = this.config[cacheType];

    // Implement LRU eviction if cache is full
    if (cache.size >= config.maxSize) {
      this.evictLRU(cacheType);
    }

    cache.set(key, {
      data,
      timestamp: now,
      lastAccess: now,
    });

    console.log(`Cache SET [${cacheType}]: ${key}`);

    // Persist long-term cache to disk
    if (cacheType === 'longTerm' && this.persistenceEnabled) {
      this.persistToDisk(key, data).catch(err => {
        console.error('Failed to persist cache to disk:', err);
      });
    }
  }

  /**
   * Evict least recently used item
   */
  evictLRU(cacheType) {
    const cache = this.caches[cacheType];
    let oldestKey = null;
    let oldestAccess = Infinity;

    for (const [key, item] of cache.entries()) {
      if (item.lastAccess < oldestAccess) {
        oldestAccess = item.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
      this.metrics.evictions++;
      console.log(`Cache EVICT [${cacheType}]: ${oldestKey}`);
    }
  }

  /**
   * Clear specific cache type or all caches
   */
  clear(cacheType = null) {
    if (cacheType) {
      const cache = this.caches[cacheType];
      if (cache) {
        cache.clear();
        console.log(`Cache cleared: ${cacheType}`);
      }
    } else {
      Object.values(this.caches).forEach(cache => cache.clear());
      console.log('All caches cleared');
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics() {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    const hitRate = totalRequests > 0 
      ? (this.metrics.hits / totalRequests * 100).toFixed(2)
      : 0;

    return {
      ...this.metrics,
      hitRate: `${hitRate}%`,
      totalRequests,
      cacheSizes: {
        longTerm: this.caches.longTerm.size,
        mediumTerm: this.caches.mediumTerm.size,
        shortTerm: this.caches.shortTerm.size,
      },
    };
  }

  /**
   * Persist cache item to disk
   */
  async persistToDisk(key, data) {
    try {
      const filename = key.replace(/[^a-z0-9]/gi, '_') + '.json';
      const filepath = path.join(this.cacheDir, filename);
      await fs.writeFile(filepath, JSON.stringify({
        key,
        data,
        timestamp: Date.now(),
      }), 'utf8');
    } catch (error) {
      console.error('Failed to persist cache:', error);
    }
  }

  /**
   * Load cache from disk
   */
  async loadFromDisk(key) {
    try {
      const filename = key.replace(/[^a-z0-9]/gi, '_') + '.json';
      const filepath = path.join(this.cacheDir, filename);
      const content = await fs.readFile(filepath, 'utf8');
      const cached = JSON.parse(content);
      
      const now = Date.now();
      const ttl = this.config.longTerm.ttl;
      
      // Check if expired
      if (now - cached.timestamp <= ttl) {
        return cached.data;
      }
      
      // Delete expired file
      await fs.unlink(filepath).catch(() => {});
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Wrapper for long-term cache operations
   */
  async getLongTerm(key) {
    let data = this.get('longTerm', key);
    if (data) return data;

    // Try loading from disk
    if (this.persistenceEnabled) {
      data = await this.loadFromDisk(key);
      if (data) {
        this.set('longTerm', key, data);
        return data;
      }
    }

    return null;
  }

  setLongTerm(key, data) {
    this.set('longTerm', key, data);
  }

  /**
   * Wrapper for medium-term cache operations
   */
  getMediumTerm(key) {
    return this.get('mediumTerm', key);
  }

  setMediumTerm(key, data) {
    this.set('mediumTerm', key, data);
  }

  /**
   * Wrapper for short-term cache operations
   */
  getShortTerm(key) {
    return this.get('shortTerm', key);
  }

  setShortTerm(key, data) {
    this.set('shortTerm', key, data);
  }
}

// Export singleton instance
module.exports = new CacheService();
