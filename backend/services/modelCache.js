const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('../config/ai3d-providers');

/**
 * Model Cache Service
 * Aggressive caching for 3D models with semantic similarity matching
 * 30-day TTL, disk-based persistent storage, LRU eviction
 */
class ModelCache {
  constructor() {
    this.cacheDir = path.join(__dirname, '../db/cache');
    this.indexPath = path.join(this.cacheDir, 'index.json');
    this.enabled = config.cache.enabled;
    this.ttlMs = config.cache.ttlDays * 24 * 60 * 60 * 1000;
    this.similarityThreshold = config.cache.similarityThreshold;
    this.maxSizeBytes = config.cache.maxSizeMB * 1024 * 1024;
    this.index = null;
  }

  /**
   * Initialize cache directory and index
   */
  async initialize() {
    if (!this.enabled) {
      console.log('📦 Model cache is disabled');
      return;
    }

    try {
      // Create cache directory if it doesn't exist
      await fs.mkdir(this.cacheDir, { recursive: true });

      // Load or create index
      try {
        const indexData = await fs.readFile(this.indexPath, 'utf8');
        this.index = JSON.parse(indexData);
      } catch (error) {
        // Create new index
        this.index = {
          entries: {},
          stats: {
            hits: 0,
            misses: 0,
            evictions: 0,
            totalSize: 0,
          },
        };
        await this.saveIndex();
      }

      console.log('📦 Model cache initialized:', {
        entries: Object.keys(this.index.entries).length,
        hitRate: this.getHitRate(),
      });
    } catch (error) {
      console.error('Error initializing model cache:', error);
      this.enabled = false;
    }
  }

  /**
   * Save cache index to disk
   */
  async saveIndex() {
    try {
      await fs.writeFile(this.indexPath, JSON.stringify(this.index, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving cache index:', error);
    }
  }

  /**
   * Generate cache key from prompt
   */
  generateKey(prompt, mode = 'ultra_cheap') {
    const normalized = prompt.toLowerCase().trim();
    const hash = crypto.createHash('sha256').update(`${normalized}:${mode}`).digest('hex');
    return hash;
  }

  /**
   * Calculate similarity between two prompts using Jaccard similarity
   */
  calculateSimilarity(prompt1, prompt2) {
    const words1 = new Set(prompt1.toLowerCase().split(/\s+/));
    const words2 = new Set(prompt2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Find similar cached entry
   */
  async findSimilar(prompt, mode = 'ultra_cheap') {
    if (!this.enabled || !this.index) {
      return null;
    }

    const normalizedPrompt = prompt.toLowerCase().trim();
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const [key, entry] of Object.entries(this.index.entries)) {
      // Skip expired entries
      if (this.isExpired(entry)) {
        continue;
      }

      // Skip different modes
      if (entry.mode !== mode) {
        continue;
      }

      const similarity = this.calculateSimilarity(normalizedPrompt, entry.prompt);

      if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = { key, entry, similarity };
      }
    }

    return bestMatch;
  }

  /**
   * Get cached model
   */
  async get(prompt, mode = 'ultra_cheap') {
    if (!this.enabled) {
      return null;
    }

    await this.initialize();

    // Try exact match first
    const key = this.generateKey(prompt, mode);
    let entry = this.index.entries[key];

    // Try semantic similarity match
    if (!entry) {
      const similar = await this.findSimilar(prompt, mode);
      if (similar) {
        console.log(`📦 Cache: Semantic match found (${(similar.similarity * 100).toFixed(1)}% similar)`);
        entry = similar.entry;
      }
    }

    if (!entry) {
      this.index.stats.misses++;
      await this.saveIndex();
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      console.log('📦 Cache: Entry expired, removing');
      await this.delete(key);
      this.index.stats.misses++;
      await this.saveIndex();
      return null;
    }

    // Update access time (LRU)
    entry.lastAccessed = Date.now();
    entry.accessCount++;

    // Load model data
    try {
      const modelPath = path.join(this.cacheDir, entry.filename);
      const modelData = await fs.readFile(modelPath, 'utf8');
      const model = JSON.parse(modelData);

      this.index.stats.hits++;
      await this.saveIndex();

      console.log('📦 Cache HIT:', {
        prompt: prompt.substring(0, 50),
        mode,
        age: Math.floor((Date.now() - entry.created) / (1000 * 60 * 60 * 24)) + ' days',
      });

      return model;
    } catch (error) {
      console.error('Error loading cached model:', error);
      await this.delete(key);
      this.index.stats.misses++;
      await this.saveIndex();
      return null;
    }
  }

  /**
   * Set cached model
   */
  async set(prompt, mode, modelData, metadata = {}) {
    if (!this.enabled) {
      return;
    }

    await this.initialize();

    const key = this.generateKey(prompt, mode);
    const filename = `${key}.json`;
    const modelPath = path.join(this.cacheDir, filename);

    try {
      // Serialize model data
      const serialized = JSON.stringify(modelData);
      const size = Buffer.byteLength(serialized);

      // Check if we need to evict
      await this.evictIfNeeded(size);

      // Save model data
      await fs.writeFile(modelPath, serialized, 'utf8');

      // Update index
      this.index.entries[key] = {
        prompt: prompt.toLowerCase().trim(),
        mode,
        filename,
        size,
        created: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 0,
        metadata,
      };

      this.index.stats.totalSize += size;
      await this.saveIndex();

      console.log('📦 Cache SAVE:', {
        prompt: prompt.substring(0, 50),
        mode,
        size: (size / 1024).toFixed(2) + ' KB',
      });
    } catch (error) {
      console.error('Error caching model:', error);
    }
  }

  /**
   * Delete cached entry
   */
  async delete(key) {
    if (!this.index.entries[key]) {
      return;
    }

    const entry = this.index.entries[key];
    const modelPath = path.join(this.cacheDir, entry.filename);

    try {
      await fs.unlink(modelPath);
    } catch (error) {
      // File might not exist, that's ok
    }

    this.index.stats.totalSize -= entry.size;
    delete this.index.entries[key];
    await this.saveIndex();
  }

  /**
   * Check if entry is expired
   */
  isExpired(entry) {
    return Date.now() - entry.created > this.ttlMs;
  }

  /**
   * Evict old entries if cache is too large (LRU strategy)
   */
  async evictIfNeeded(newSize) {
    const currentSize = this.index.stats.totalSize;
    const targetSize = this.maxSizeBytes * 0.8; // Keep 80% as target after eviction

    if (currentSize + newSize <= this.maxSizeBytes) {
      return; // No eviction needed
    }

    console.log('📦 Cache eviction needed:', {
      current: (currentSize / 1024 / 1024).toFixed(2) + ' MB',
      max: (this.maxSizeBytes / 1024 / 1024).toFixed(2) + ' MB',
    });

    // Sort entries by last accessed (LRU)
    const entries = Object.entries(this.index.entries)
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

    // Evict until we're under target size
    let freedSpace = 0;
    for (const [key, entry] of entries) {
      if (currentSize - freedSpace + newSize <= targetSize) {
        break;
      }

      await this.delete(key);
      freedSpace += entry.size;
      this.index.stats.evictions++;
    }

    console.log('📦 Evicted:', {
      freed: (freedSpace / 1024 / 1024).toFixed(2) + ' MB',
      remaining: (this.index.stats.totalSize / 1024 / 1024).toFixed(2) + ' MB',
    });
  }

  /**
   * Clean up expired entries
   */
  async cleanup() {
    if (!this.enabled || !this.index) {
      return;
    }

    let cleaned = 0;
    const entries = Object.entries(this.index.entries);

    for (const [key, entry] of entries) {
      if (this.isExpired(entry)) {
        await this.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`📦 Cache cleanup: Removed ${cleaned} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    if (!this.enabled || !this.index) {
      return null;
    }

    return {
      enabled: this.enabled,
      entries: Object.keys(this.index.entries).length,
      totalSize: this.index.stats.totalSize,
      totalSizeMB: (this.index.stats.totalSize / 1024 / 1024).toFixed(2),
      hits: this.index.stats.hits,
      misses: this.index.stats.misses,
      evictions: this.index.stats.evictions,
      hitRate: this.getHitRate(),
      maxSizeMB: config.cache.maxSizeMB,
      ttlDays: config.cache.ttlDays,
      similarityThreshold: config.cache.similarityThreshold,
    };
  }

  /**
   * Get cache hit rate
   */
  getHitRate() {
    if (!this.index) {
      return 0;
    }

    const total = this.index.stats.hits + this.index.stats.misses;
    return total > 0 ? this.index.stats.hits / total : 0;
  }

  /**
   * Clear all cache
   */
  async clear() {
    if (!this.enabled || !this.index) {
      return;
    }

    const entries = Object.keys(this.index.entries);
    for (const key of entries) {
      await this.delete(key);
    }

    console.log('📦 Cache cleared');
  }
}

module.exports = new ModelCache();
