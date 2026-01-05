import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const MECHANICAL_BASE = `${API_BASE_URL}/mechanical`;

class APIService {
  /**
   * Generate design from prompt using job-based endpoint
   * Returns a job ID and polls for completion
   */
  async generateDesign(prompt, onProgress = null) {
    console.log('🎯 API Service: generateDesign called');
    console.log('  Prompt:', prompt?.substring(0, 50) + '...');
    console.log('  Endpoint: POST', `${MECHANICAL_BASE}/generate`);

    try {
      // Step 1: Start the generation job
      console.log('📡 Starting generation job with prompt:', prompt);
      const startResponse = await axios.post(`${MECHANICAL_BASE}/generate`, { prompt });

      if (!startResponse.data.success || !startResponse.data.jobId) {
        throw new Error('Failed to start generation job');
      }

      const jobId = startResponse.data.jobId;
      console.log('✅ Generation job started, jobId:', jobId);

      // Step 2: Poll for job completion with proper cleanup
      const result = await this.pollJobStatus(jobId, onProgress);

      console.log('✅ Generation completed successfully');
      return result;
    } catch (error) {
      console.error('❌ Error generating design:', error);
      throw error;
    }
  }

  /**
   * Poll job status until completion or timeout
   * Uses async/await pattern with proper cleanup instead of setInterval
   */
  async pollJobStatus(jobId, onProgress = null, maxAttempts = 120, pollInterval = 1000) {
    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;
    let lastProgress = null; // Track last progress to avoid redundant callbacks

    console.log('🔄 Starting job polling:', { jobId, maxAttempts, pollInterval });

    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${MECHANICAL_BASE}/generate/${jobId}`);
        const job = response.data;

        if (!job) {
          throw new Error('Job not found');
        }

        // Log polling progress
        if (attempts % 10 === 0) {
          console.log(`🔄 Polling attempt ${attempts}/${maxAttempts} - Status: ${job.status}`);
        }

        // Notify progress callback if provided
        if (onProgress) {
          const currentProgress = {
            status: job.status,
            progress: job.progress,
            stages: job.stages,
          };

          // Only call callback if progress actually changed
          const progressChanged = !lastProgress ||
            lastProgress.status !== currentProgress.status ||
            lastProgress.progress !== currentProgress.progress ||
            JSON.stringify(lastProgress.stages) !== JSON.stringify(currentProgress.stages);

          if (progressChanged) {
            onProgress(currentProgress);
            lastProgress = currentProgress;
          }
        }

        // Check if job is completed
        if (job.status === 'completed') {
          console.log('✅ Job completed successfully:', jobId);
          console.log('🛑 Polling stopped - job complete');
          return {
            success: true,
            design: job.result?.design,
            modelData: job.result?.modelData || job.result?.design?.model, // Use modelData from result
            designId: job.result?.designId, // Include designId for multi-design tracking
          };
        }

        // Check if job failed
        if (job.status === 'failed') {
          console.error('❌ Job failed:', job.error);
          console.log('🛑 Polling stopped - job failed');
          throw new Error(job.error || 'Generation failed');
        }

        // Continue polling
        await this.delay(pollInterval);
        attempts++;

      } catch (error) {
        consecutiveErrors++;

        if (error.response?.status === 404) {
          console.error('❌ Job not found:', jobId);
          throw new Error('Job not found');
        }
        console.error('❌ Error polling job status:', error);
        throw error;
      }
    }

    // Timeout reached
    console.error('❌ Polling timeout after', maxAttempts, 'attempts');
    console.log('🛑 Polling stopped - timeout reached');
    throw new Error(`Generation timeout - job did not complete within ${maxAttempts} seconds`);
  }

  /**
   * Cancel a generation job
   */
  async cancelJob(jobId) {
    try {
      await axios.delete(`${MECHANICAL_BASE}/generate/${jobId}`);
      return { success: true };
    } catch (error) {
      console.error('Error canceling job:', error);
      throw error;
    }
  }

  /**
   * Helper to delay execution
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Analyze design
   */
  async analyzeDesign(design) {
    try {
      const response = await axios.post(`${MECHANICAL_BASE}/analysis/analyze`, { design });
      return response.data;
    } catch (error) {
      console.error('Error analyzing design:', error);
      throw error;
    }
  }

  /**
   * Check legality/compliance
   */
  async checkCompliance(design) {
    try {
      const response = await axios.post(`${MECHANICAL_BASE}/legality/check`, { design });
      return response.data;
    } catch (error) {
      console.error('Error checking compliance:', error);
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${API_BASE_URL}/health`);
      return response.data;
    } catch (error) {
      console.error('Health check failed:', error);
      throw error;
    }
  }

  /**
   * Materials API - Get material library statistics
   */
  async getMaterialStats() {
    try {
      const response = await axios.get(`${MECHANICAL_BASE}/materials/stats`);
      return response.data;
    } catch (error) {
      console.error('Error fetching material stats:', error);
      throw error;
    }
  }

  /**
   * Materials API - Search materials
   */
  async searchMaterials(query = '', filters = {}) {
    try {
      const params = new URLSearchParams({ query, ...filters });
      const response = await axios.get(`${MECHANICAL_BASE}/materials/search?${params}`);
      return response.data;
    } catch (error) {
      console.error('Error searching materials:', error);
      throw error;
    }
  }

  /**
   * Materials API - Get material types
   */
  async getMaterialTypes() {
    try {
      const response = await axios.get(`${MECHANICAL_BASE}/materials/types`);
      return response.data;
    } catch (error) {
      console.error('Error fetching material types:', error);
      throw error;
    }
  }

  /**
   * Materials API - Get specific material by ID
   */
  async getMaterialById(id) {
    try {
      const response = await axios.get(`${MECHANICAL_BASE}/materials/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching material:', error);
      throw error;
    }
  }

  /**
   * Materials API - Refresh materials from AmbientCG API
   */
  async refreshMaterials() {
    try {
      const response = await axios.post(`${MECHANICAL_BASE}/materials/refresh`);
      return response.data;
    } catch (error) {
      console.error('Error refreshing materials:', error);
      throw error;
    }
  }

  /**
   * AI 3D Generation - Generate with quality selection
   */
  async generateDesignWithQuality(prompt, quality = 'preview') {
    try {
      const endpoint = quality === 'preview' ? '/generate/preview' : '/generate';
      const response = await axios.post(`${MECHANICAL_BASE}${endpoint}`, {
        prompt,
        options: { mode: quality === 'preview' ? 'ultra_cheap' : quality }
      });
      return response.data;
    } catch (error) {
      console.error('Error generating design with quality:', error);
      throw error;
    }
  }

  /**
   * AI 3D Generation - Upgrade existing generation quality
   */
  async upgradeGenerationQuality(jobId, targetQuality) {
    try {
      const response = await axios.post(`${MECHANICAL_BASE}/generate/${jobId}/upgrade`, {
        quality: targetQuality
      });
      return response.data;
    } catch (error) {
      console.error('Error upgrading generation quality:', error);
      throw error;
    }
  }

  /**
   * AI 3D Generation - Batch generation
   */
  async batchGenerate(prompts, quality = 'preview') {
    try {
      const response = await axios.post(`${MECHANICAL_BASE}/generate/batch`, {
        prompts,
        mode: quality === 'preview' ? 'ultra_cheap' : quality
      });
      return response.data;
    } catch (error) {
      console.error('Error in batch generation:', error);
      throw error;
    }
  }

  /**
   * Credits API - Get credit status
   */
  async getCreditStatus() {
    try {
      const response = await axios.get(`${MECHANICAL_BASE}/credits/status`);
      return response.data;
    } catch (error) {
      console.error('Error fetching credit status:', error);
      throw error;
    }
  }

  /**
   * Credits API - Get usage statistics
   */
  async getUsageStats() {
    try {
      const response = await axios.get(`${MECHANICAL_BASE}/credits/usage`);
      return response.data;
    } catch (error) {
      console.error('Error fetching usage stats:', error);
      throw error;
    }
  }

  /**
   * Credits API - Get cost forecast
   */
  async getCostForecast() {
    try {
      const response = await axios.get(`${MECHANICAL_BASE}/credits/forecast`);
      return response.data;
    } catch (error) {
      console.error('Error fetching cost forecast:', error);
      throw error;
    }
  }

  /**
   * AI 3D Generation - Get cost estimate before generation
   */
  async estimateGenerationCost(prompt, quality) {
    try {
      const response = await axios.post(`${MECHANICAL_BASE}/generate/estimate`, {
        prompt,
        mode: quality === 'preview' ? 'ultra_cheap' : quality
      });
      return response.data;
    } catch (error) {
      console.error('Error estimating generation cost:', error);
      throw error;
    }
  }

  /**
   * Generate multiple ultra-realistic design variants (Phase 1)
   * Returns 3 design variants with different emphases
   */
  async generateVariants(prompt, options = {}) {
    try {
      console.log('🎨 Starting multi-variant generation:', prompt);

      const response = await axios.post(`${MECHANICAL_BASE}/generate/variants`, {
        prompt,
        options,
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to generate variants');
      }

      console.log(`✅ Multi-variant generation complete: ${response.data.variants?.length || 0} variants`);
      return response.data;
    } catch (error) {
      console.error('Error generating variants:', error);

      // Enhanced error messages
      if (error.response?.status === 503) {
        throw new Error('Multi-variant generation is not enabled. Please configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend.');
      } else if (error.response?.status === 500) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || 'Server error';
        throw new Error(`Variant generation failed: ${errorMsg}`);
      } else if (error.message?.includes('Network Error')) {
        throw new Error('Network error: Cannot connect to API server.');
      }

      throw error;
    }
  }

  /**
   * Generate fantasy/unrealistic design variants with image generation
   * Uses AWS Bedrock's Nano Banana Pro (image generation) for concept images
   * Returns 3 fantasy variants with concept image descriptions
   */
  async generateFantasyVariants(prompt, options = {}) {
    try {
      console.log('🎨 Starting fantasy variant generation:', prompt);
      console.log('🎭 Using Nano Banana Pro (AWS Bedrock Image Generation)');

      const response = await axios.post(`${MECHANICAL_BASE}/generate/fantasy-variants`, {
        prompt,
        options,
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to generate fantasy variants');
      }

      console.log(`✅ Fantasy variant generation complete: ${response.data.variants?.length || 0} variants`);
      console.log(`🎨 With ${response.data.metadata?.hasConceptImages || 0} concept images`);
      return response.data;
    } catch (error) {
      console.error('Error generating fantasy variants:', error);

      // Enhanced error messages
      if (error.response?.status === 503) {
        throw new Error('Fantasy variant generation is not enabled. Please configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend.');
      } else if (error.response?.status === 500) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || 'Server error';
        throw new Error(`Fantasy variant generation failed: ${errorMsg}`);
      } else if (error.message?.includes('Network Error')) {
        throw new Error('Network error: Cannot connect to API server.');
      }

      throw error;
    }
  }
}

export default new APIService();
