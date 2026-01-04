const axios = require('axios');
const config = require('../config/ai3d-providers');
const creditManager = require('./creditManager');

/**
 * Tripo AI Service
 * Text-to-3D and Image-to-3D generation with free tier prioritization
 * Supports preview, standard, and high quality modes
 */
class TripoService {
  constructor() {
    this.apiKey = process.env.TRIPO_API_KEY;
    this.baseURL = config.tripo.baseURL;
    this.config = config.tripo;
    this.enabled = !!this.apiKey && config.features.ai3DGeneration;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Make API request to Tripo
   */
  async makeRequest(endpoint, data, options = {}) {
    if (!this.enabled) {
      throw new Error('Tripo AI service is not enabled. Please set TRIPO_API_KEY.');
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
      console.error('Tripo API error:', error.response?.data || error.message);
      throw new Error(`Tripo AI error: ${error.response?.data?.message || error.message}`);
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

        if (status === 'completed') {
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
   * Generate 3D model from text prompt
   */
  async textTo3D(prompt, quality = 'preview') {
    const creditsNeeded = this.config.costs[quality] || this.config.costs.preview;

    // Check free tier availability
    const canUseFree = await creditManager.canUseFreeTier('tripo', creditsNeeded);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;

    // Check budget
    const costUSD = useFreeTier ? 0 : (creditsNeeded / 100); // Rough estimate
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget. Please wait for next month or increase budget.');
    }

    console.log('🎨 Tripo: Starting text-to-3D generation:', {
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
        format: 'glb', // Default format
      });

      const taskId = taskData.task_id || taskData.id;

      // Poll for completion
      const result = await this.pollTaskStatus(taskId);

      // Record usage
      await creditManager.recordUsage('tripo', creditsNeeded, costUSD, {
        type: 'text-to-3d',
        quality,
        prompt: prompt.substring(0, 100),
        taskId,
      });

      console.log('✅ Tripo: Generation completed');

      return {
        success: true,
        taskId,
        modelUrl: result.model_url || result.output?.model_url,
        thumbnailUrl: result.thumbnail_url || result.output?.thumbnail_url,
        format: 'glb',
        creditsUsed: creditsNeeded,
        costUSD,
        provider: 'tripo',
      };
    } catch (error) {
      console.error('❌ Tripo: Generation failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate 3D model from image
   */
  async imageTo3D(imageUrl, quality = 'preview') {
    const creditsNeeded = this.config.costs[quality] || this.config.costs.preview;

    // Check free tier availability
    const canUseFree = await creditManager.canUseFreeTier('tripo', creditsNeeded);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;

    // Check budget
    const costUSD = useFreeTier ? 0 : (creditsNeeded / 100);
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget');
    }

    console.log('🎨 Tripo: Starting image-to-3D generation:', {
      imageUrl: imageUrl.substring(0, 50),
      quality,
      creditsNeeded,
      useFreeTier,
    });

    try {
      const taskData = await this.makeRequest(this.config.endpoints.imageTo3D, {
        image_url: imageUrl,
        quality,
        format: 'glb',
      });

      const taskId = taskData.task_id || taskData.id;
      const result = await this.pollTaskStatus(taskId);

      await creditManager.recordUsage('tripo', creditsNeeded, costUSD, {
        type: 'image-to-3d',
        quality,
        taskId,
      });

      console.log('✅ Tripo: Image-to-3D completed');

      return {
        success: true,
        taskId,
        modelUrl: result.model_url || result.output?.model_url,
        thumbnailUrl: result.thumbnail_url || result.output?.thumbnail_url,
        format: 'glb',
        creditsUsed: creditsNeeded,
        costUSD,
        provider: 'tripo',
      };
    } catch (error) {
      console.error('❌ Tripo: Image-to-3D failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate 3D model from multiple images (best quality)
   */
  async multiImageTo3D(imageUrls, quality = 'standard') {
    const creditsNeeded = this.config.costs.high; // Multi-image uses more credits

    const canUseFree = await creditManager.canUseFreeTier('tripo', creditsNeeded);
    const useFreeTier = config.features.useFreeTierFirst && canUseFree;

    const costUSD = useFreeTier ? 0 : (creditsNeeded / 100);
    const budgetCheck = await creditManager.isWithinBudget(costUSD);

    if (!budgetCheck.withinBudget) {
      throw new Error('Generation would exceed monthly budget');
    }

    console.log('🎨 Tripo: Starting multi-image-to-3D generation:', {
      imageCount: imageUrls.length,
      quality,
      creditsNeeded,
    });

    try {
      const taskData = await this.makeRequest(this.config.endpoints.multiImageTo3D, {
        image_urls: imageUrls,
        quality,
        format: 'glb',
      });

      const taskId = taskData.task_id || taskData.id;
      const result = await this.pollTaskStatus(taskId);

      await creditManager.recordUsage('tripo', creditsNeeded, costUSD, {
        type: 'multi-image-to-3d',
        quality,
        imageCount: imageUrls.length,
        taskId,
      });

      console.log('✅ Tripo: Multi-image-to-3D completed');

      return {
        success: true,
        taskId,
        modelUrl: result.model_url || result.output?.model_url,
        thumbnailUrl: result.thumbnail_url || result.output?.thumbnail_url,
        format: 'glb',
        creditsUsed: creditsNeeded,
        costUSD,
        provider: 'tripo',
      };
    } catch (error) {
      console.error('❌ Tripo: Multi-image-to-3D failed:', error.message);
      throw error;
    }
  }

  /**
   * Get estimated cost for a generation
   */
  async estimateCost(type = 'text-to-3d', quality = 'preview') {
    const creditsNeeded = this.config.costs[quality] || this.config.costs.preview;
    const canUseFree = await creditManager.canUseFreeTier('tripo', creditsNeeded);
    const costUSD = canUseFree ? 0 : (creditsNeeded / 100);

    return {
      provider: 'tripo',
      type,
      quality,
      creditsNeeded,
      canUseFreeTier: canUseFree,
      estimatedCostUSD: costUSD,
    };
  }
}

module.exports = new TripoService();
