const axios = require('axios');
const config = require('../config/ai3d-providers');
const creditManager = require('./creditManager');

/**
 * Meshy AI Service
 * Text-to-3D and Image-to-3D with high-quality PBR textures
 * Focus on production-ready 3D models
 */
class MeshyService {
  constructor() {
    this.apiKey = process.env.MESHY_API_KEY;
    this.baseURL = config.meshy.baseURL;
    this.config = config.meshy;
    this.enabled = !!this.apiKey && config.features.ai3DGeneration;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Make API request to Meshy
   */
  async makeRequest(endpoint, data, options = {}) {
    if (!this.enabled) {
      throw new Error('Meshy AI service is not enabled. Please set MESHY_API_KEY.');
    }

    try {
      const response = await axios.post(`${this.baseURL}${endpoint}`, data, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: options.timeout || this.config.timeout,
      });

      return response.data;
    } catch (error) {
      console.error('Meshy API error:', error.response?.data || error.message);
      throw new Error(`Meshy AI error: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Poll task status until completion
   */
  async pollTaskStatus(taskId, maxAttempts = 60, pollInterval = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(`${this.baseURL}${this.config.endpoints.status}/${taskId}`, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        });

        const status = response.data.status;

        if (status === 'completed' || status === 'succeeded') {
          return response.data;
        }

        if (status === 'failed') {
          throw new Error(`Task failed: ${response.data.error || 'Unknown error'}`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        if (i === maxAttempts - 1) {
          throw error;
        }
      }
    }

    throw new Error('Task timeout - generation did not complete in time');
  }

  /**
   * Generate 3D model from text prompt with PBR materials
   */
  async textTo3D(prompt, quality = 'standard') {
    const creditsNeeded = this.config.costs[quality] || this.config.costs.standard;

    // Check free tier availability
    const canUseFree = await creditManager.canUseFreeTier('meshy', creditsNeeded);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;

    // Check budget
    const costUSD = useFreeTier ? 0 : (creditsNeeded / 100);
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget. Please wait for next month or increase budget.');
    }

    console.log('🎨 Meshy: Starting text-to-3D generation:', {
      prompt: prompt.substring(0, 50),
      quality,
      creditsNeeded,
      useFreeTier,
      estimatedCost: costUSD,
    });

    try {
      // Start generation task
      const taskData = await this.makeRequest(this.config.endpoints.textTo3D, {
        prompt,
        quality,
        art_style: 'realistic',
        negative_prompt: 'low quality, blurry, distorted',
        enable_pbr: quality === 'high', // PBR for high quality
      });

      const taskId = taskData.task_id || taskData.id || taskData.result;

      // Poll for completion
      const result = await this.pollTaskStatus(taskId);

      // Record usage
      await creditManager.recordUsage('meshy', creditsNeeded, costUSD, {
        type: 'text-to-3d',
        quality,
        prompt: prompt.substring(0, 100),
        taskId,
      });

      console.log('✅ Meshy: Generation completed');

      return {
        success: true,
        taskId,
        modelUrl: result.model_url || result.model_urls?.glb || result.output?.model_url,
        thumbnailUrl: result.thumbnail_url || result.thumbnail || result.output?.thumbnail_url,
        format: 'glb',
        hasPBR: quality === 'high',
        creditsUsed: creditsNeeded,
        costUSD,
        provider: 'meshy',
      };
    } catch (error) {
      console.error('❌ Meshy: Generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate 3D model from image with PBR textures
   */
  async imageTo3D(imageUrl, quality = 'standard') {
    const creditsNeeded = this.config.costs[quality] || this.config.costs.standard;

    // Check free tier availability
    const canUseFree = await creditManager.canUseFreeTier('meshy', creditsNeeded);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;

    // Check budget
    const costUSD = useFreeTier ? 0 : (creditsNeeded / 100);
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget');
    }

    console.log('🎨 Meshy: Starting image-to-3D generation:', {
      imageUrl: imageUrl.substring(0, 50),
      quality,
      creditsNeeded,
      useFreeTier,
    });

    try {
      const taskData = await this.makeRequest(this.config.endpoints.imageTo3D, {
        image_url: imageUrl,
        quality,
        enable_pbr: quality === 'high',
      });

      const taskId = taskData.task_id || taskData.id || taskData.result;
      const result = await this.pollTaskStatus(taskId);

      await creditManager.recordUsage('meshy', creditsNeeded, costUSD, {
        type: 'image-to-3d',
        quality,
        taskId,
      });

      console.log('✅ Meshy: Image-to-3D completed');

      return {
        success: true,
        taskId,
        modelUrl: result.model_url || result.model_urls?.glb || result.output?.model_url,
        thumbnailUrl: result.thumbnail_url || result.thumbnail || result.output?.thumbnail_url,
        format: 'glb',
        hasPBR: quality === 'high',
        creditsUsed: creditsNeeded,
        costUSD,
        provider: 'meshy',
      };
    } catch (error) {
      console.error('❌ Meshy: Image-to-3D failed:', error.message);
      throw error;
    }
  }

  /**
   * Get estimated cost for a generation
   */
  async estimateCost(type = 'text-to-3d', quality = 'standard') {
    const creditsNeeded = this.config.costs[quality] || this.config.costs.standard;
    const canUseFree = await creditManager.canUseFreeTier('meshy', creditsNeeded);
    const costUSD = canUseFree ? 0 : (creditsNeeded / 100);

    return {
      provider: 'meshy',
      type,
      quality,
      creditsNeeded,
      canUseFreeTier: canUseFree,
      estimatedCostUSD: costUSD,
    };
  }
}

module.exports = new MeshyService();
