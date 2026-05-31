/**
 * Texture Streaming System
 * Handles progressive texture loading, LOD-based quality adjustment, and memory management
 */

import * as THREE from 'three';
import { renderConfig, getResolutionForDistance, estimateTextureMemory, parseResolution } from '../config/renderConfig';

export class TextureStreamingSystem {
  constructor() {
    this.textureLoader = new THREE.TextureLoader();
    this.loadingQueue = [];
    this.loadedTextures = new Map();
    this.textureMetadata = new Map();
    this.currentMemoryUsage = 0;
    this.lastCleanupTime = Date.now();
  }

  /**
   * Load texture progressively (placeholder → full resolution)
   */
  async loadTextureProgressive(url, priority = 'normal') {
    if (!url) return null;

    console.log(`📥 Progressive loading texture: ${url} (priority: ${priority})`);

    // Check if already loaded
    if (this.loadedTextures.has(url)) {
      this.updateAccessTime(url);
      return this.loadedTextures.get(url);
    }

    // Create placeholder texture immediately
    const placeholder = this.createPlaceholderTexture();

    // Add to loading queue
    const loadTask = {
      url,
      priority: this.getPriorityValue(priority),
      placeholder,
      resolve: null,
      reject: null,
    };

    const promise = new Promise((resolve, reject) => {
      loadTask.resolve = resolve;
      loadTask.reject = reject;
    });

    this.loadingQueue.push(loadTask);
    this.sortLoadingQueue();
    this.processLoadingQueue();

    return promise;
  }

  /**
   * Create a gray placeholder texture
   */
  createPlaceholderTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 16, 16);

    const texture = new THREE.CanvasTexture(canvas);
    texture.isPlaceholder = true;
    return texture;
  }

  /**
   * Get numeric priority value
   */
  getPriorityValue(priority) {
    const priorities = {
      high: 3,
      normal: 2,
      low: 1,
    };
    return priorities[priority] || 2;
  }

  /**
   * Sort loading queue by priority
   */
  sortLoadingQueue() {
    this.loadingQueue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Process loading queue
   */
  async processLoadingQueue() {
    if (this.loadingQueue.length === 0) return;

    // Check memory before loading
    if (this.currentMemoryUsage > renderConfig.memory.maxTextureMemory) {
      console.warn('⚠️  Memory limit reached, cleaning up...');
      this.clearUnusedTextures();
    }

    // Load next texture in queue
    const task = this.loadingQueue.shift();
    if (!task) return;

    try {
      const texture = await this.loadTextureFromUrl(task.url);
      
      // Track memory usage
      const memorySize = this.estimateTextureSize(texture);
      this.currentMemoryUsage += memorySize;

      // Store texture and metadata
      this.loadedTextures.set(task.url, texture);
      this.textureMetadata.set(task.url, {
        memorySize,
        loadTime: Date.now(),
        lastAccessTime: Date.now(),
        accessCount: 1,
      });

      console.log(`✅ Texture loaded: ${task.url} (${(memorySize / 1024 / 1024).toFixed(2)} MB)`);
      task.resolve(texture);
    } catch (error) {
      console.error(`❌ Failed to load texture: ${task.url}`, error);
      task.resolve(task.placeholder); // Return placeholder on error
    }

    // Continue processing queue
    if (this.loadingQueue.length > 0) {
      setTimeout(() => this.processLoadingQueue(), 10);
    }
  }

  /**
   * Load texture from URL
   */
  loadTextureFromUrl(url) {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = 16;
          texture.encoding = THREE.sRGBEncoding;
          resolve(texture);
        },
        undefined,
        reject
      );
    });
  }

  /**
   * Estimate texture memory size
   */
  estimateTextureSize(texture) {
    if (!texture.image) return 1024; // Default 1KB

    const width = texture.image.width || 512;
    const height = texture.image.height || 512;
    return estimateTextureMemory(width, height, 'RGBA');
  }

  /**
   * Update access time for texture
   */
  updateAccessTime(url) {
    const metadata = this.textureMetadata.get(url);
    if (metadata) {
      metadata.lastAccessTime = Date.now();
      metadata.accessCount++;
    }
  }

  /**
   * Update texture quality based on camera distance (LOD)
   */
  updateTextureLOD(camera, objects) {
    if (!camera || !objects) return;

    objects.forEach(obj => {
      if (!obj.material || !obj.material.map) return;

      // Calculate distance from camera
      const distance = camera.position.distanceTo(obj.position);
      
      // Determine appropriate resolution
      const targetResolution = getResolutionForDistance(distance);
      
      // Check if we need to change resolution
      const currentRes = obj.material.userData?.currentResolution;
      if (currentRes !== targetResolution) {
        this.switchTextureResolution(obj, targetResolution);
        obj.material.userData = obj.material.userData || {};
        obj.material.userData.currentResolution = targetResolution;
      }
    });
  }

  /**
   * Switch texture to different resolution
   */
  async switchTextureResolution(object, resolution) {
    if (!object.material || !object.material.userData?.originalTextureUrl) return;

    const baseUrl = object.material.userData.originalTextureUrl;
    const newUrl = this.getUrlForResolution(baseUrl, resolution);

    try {
      const newTexture = await this.loadTextureProgressive(newUrl, 'high');
      
      // Dispose old texture
      if (object.material.map && !object.material.map.isPlaceholder) {
        object.material.map.dispose();
      }
      
      object.material.map = newTexture;
      object.material.needsUpdate = true;
      
      console.log(`🔄 Switched texture resolution to ${resolution}`);
    } catch (error) {
      console.error('Failed to switch texture resolution:', error);
    }
  }

  /**
   * Get URL for specific resolution
   */
  getUrlForResolution(baseUrl, resolution) {
    // Replace resolution in URL (handles common patterns)
    const resolutionPattern = /_(4K|2K|1K|512)/i;
    if (resolutionPattern.test(baseUrl)) {
      return baseUrl.replace(resolutionPattern, `_${resolution}`);
    }
    return baseUrl;
  }

  /**
   * Clear unused textures to free memory
   */
  clearUnusedTextures() {
    const now = Date.now();
    const timeout = renderConfig.memory.textureTimeout;
    let freedMemory = 0;

    console.log('🗑️  Clearing unused textures...');

    this.textureMetadata.forEach((metadata, url) => {
      const timeSinceAccess = now - metadata.lastAccessTime;
      
      // Remove if not accessed recently
      if (timeSinceAccess > timeout) {
        const texture = this.loadedTextures.get(url);
        if (texture) {
          texture.dispose();
          freedMemory += metadata.memorySize;
        }
        
        this.loadedTextures.delete(url);
        this.textureMetadata.delete(url);
      }
    });

    this.currentMemoryUsage -= freedMemory;
    this.lastCleanupTime = now;

    console.log(`✅ Freed ${(freedMemory / 1024 / 1024).toFixed(2)} MB`);
  }

  /**
   * Force cleanup of all textures
   */
  clearAll() {
    console.log('🗑️  Clearing all textures');

    this.loadedTextures.forEach((texture) => {
      texture.dispose();
    });

    this.loadedTextures.clear();
    this.textureMetadata.clear();
    this.currentMemoryUsage = 0;
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    return {
      current: this.currentMemoryUsage,
      max: renderConfig.memory.maxTextureMemory,
      percentage: (this.currentMemoryUsage / renderConfig.memory.maxTextureMemory) * 100,
      textureCount: this.loadedTextures.size,
      loadingQueueSize: this.loadingQueue.length,
      currentMB: (this.currentMemoryUsage / 1024 / 1024).toFixed(2),
      maxMB: (renderConfig.memory.maxTextureMemory / 1024 / 1024).toFixed(2),
    };
  }

  /**
   * Get statistics
   */
  getStats() {
    const memUsage = this.getMemoryUsage();
    
    return {
      ...memUsage,
      timeSinceLastCleanup: Date.now() - this.lastCleanupTime,
      loadedTextures: Array.from(this.textureMetadata.entries()).map(([url, meta]) => ({
        url,
        sizeMB: (meta.memorySize / 1024 / 1024).toFixed(2),
        accessCount: meta.accessCount,
        age: Date.now() - meta.loadTime,
      })),
    };
  }
}

export default TextureStreamingSystem;
