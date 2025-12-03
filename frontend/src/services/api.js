import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

class APIService {
  /**
   * Generate design from prompt using job-based endpoint
   * Returns a job ID and polls for completion
   */
  async generateDesign(prompt, onProgress = null) {
    try {
      // Step 1: Start the generation job
      console.log('Starting generation job with prompt:', prompt);
      const startResponse = await axios.post(`${API_BASE_URL}/generate`, { prompt });
      
      if (!startResponse.data.success || !startResponse.data.jobId) {
        throw new Error('Failed to start generation job');
      }
      
      const jobId = startResponse.data.jobId;
      console.log('Generation job started, jobId:', jobId);
      
      // Step 2: Poll for job completion
      const result = await this.pollJobStatus(jobId, onProgress);
      
      return result;
    } catch (error) {
      console.error('Error generating design:', error);
      
      // Enhanced error messages
      if (error.response?.status === 500) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || 'Server error';
        throw new Error(`Generation failed: ${errorMsg}. Please check API configuration and try again.`);
      } else if (error.response?.status === 403) {
        throw new Error('CORS error: Origin not allowed. Please check ALLOWED_ORIGINS configuration.');
      } else if (error.message?.includes('Network Error')) {
        throw new Error('Network error: Cannot connect to API server. Please check your connection.');
      }
      
      throw error;
    }
  }
  
  /**
   * Poll job status until completion or timeout
   */
  async pollJobStatus(jobId, onProgress = null, maxAttempts = 120, pollInterval = 1000) {
    let attempts = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;
    let lastProgress = null; // Track last progress to avoid redundant callbacks
    
    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${API_BASE_URL}/generate/${jobId}`);
        const job = response.data.job;
        
        if (!job) {
          throw new Error('Job not found');
        }
        
        // Reset error counter on successful request
        consecutiveErrors = 0;
        
        // Notify progress callback if provided AND progress has changed
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
          console.log('Job completed successfully:', jobId);
          return {
            success: true,
            design: job.result?.design,
            modelData: job.result?.modelData || job.result?.design?.model, // Use modelData from result
            designId: job.result?.designId, // Include designId for multi-design tracking
          };
        }
        
        // Check if job failed
        if (job.status === 'failed') {
          console.error('Job failed:', job.error);
          throw new Error(job.error || 'Generation failed');
        }
        
        // Continue polling
        await this.delay(pollInterval);
        attempts++;
        
      } catch (error) {
        consecutiveErrors++;
        
        if (error.response?.status === 404) {
          throw new Error('Job not found');
        }
        
        // If we've had multiple consecutive errors, give up
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('Too many consecutive polling errors:', error);
          throw new Error(`Polling failed: ${error.message}`);
        }
        
        // Otherwise, wait and retry
        console.warn(`Polling error (${consecutiveErrors}/${maxConsecutiveErrors}), retrying...`);
        await this.delay(pollInterval * 2); // Wait longer on error
        attempts++;
      }
    }
    
    throw new Error('Generation timeout - job did not complete in time');
  }
  
  /**
   * Cancel a generation job
   */
  async cancelJob(jobId) {
    try {
      await axios.delete(`${API_BASE_URL}/generate/${jobId}`);
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
      const response = await axios.post(`${API_BASE_URL}/analysis/analyze`, { design });
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
      const response = await axios.post(`${API_BASE_URL}/legality/check`, { design });
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
      const response = await axios.get(`${API_BASE_URL}/materials/stats`);
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
      const response = await axios.get(`${API_BASE_URL}/materials/search?${params}`);
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
      const response = await axios.get(`${API_BASE_URL}/materials/types`);
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
      const response = await axios.get(`${API_BASE_URL}/materials/${id}`);
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
      const response = await axios.post(`${API_BASE_URL}/materials/refresh`);
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
      const response = await axios.post(`${API_BASE_URL}${endpoint}`, {
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
      const response = await axios.post(`${API_BASE_URL}/generate/${jobId}/upgrade`, {
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
      const response = await axios.post(`${API_BASE_URL}/generate/batch`, {
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
      const response = await axios.get(`${API_BASE_URL}/credits/status`);
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
      const response = await axios.get(`${API_BASE_URL}/credits/usage`);
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
      const response = await axios.get(`${API_BASE_URL}/credits/forecast`);
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
      const response = await axios.post(`${API_BASE_URL}/generate/estimate`, {
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
      
      const response = await axios.post(`${API_BASE_URL}/generate/variants`, {
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
        throw new Error('Multi-variant generation is not enabled. Please configure GEMINI_API_KEY in backend.');
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
   * Uses Gemini's Nano Banana Pro (image generation) for concept images
   * Returns 3 fantasy variants with concept image descriptions
   */
  async generateFantasyVariants(prompt, options = {}) {
    try {
      console.log('🎨 Starting fantasy variant generation:', prompt);
      console.log('🎭 Using Nano Banana Pro (Gemini Image Generation)');
      
      const response = await axios.post(`${API_BASE_URL}/generate/fantasy-variants`, {
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
        throw new Error('Fantasy variant generation is not enabled. Please configure GEMINI_API_KEY in backend.');
      } else if (error.response?.status === 500) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || 'Server error';
        throw new Error(`Fantasy variant generation failed: ${errorMsg}`);
      } else if (error.message?.includes('Network Error')) {
        throw new Error('Network error: Cannot connect to API server.');
      }
      
      throw error;
    }
  }

  /**
   * Create a 3D design from a selected variant
   * Takes the variant object selected by the user and generates the full 3D model
   */
  async createDesignFromVariant(variant, prompt, onProgress = null, options = {}) {
    try {
      console.log('🎯 Creating design from selected variant:', variant.title);
      
      // Step 1: Start the design creation job
      const startResponse = await axios.post(`${API_BASE_URL}/generate/create-design`, {
        variant,
        prompt,
        options,
      });
      
      if (!startResponse.data.success || !startResponse.data.jobId) {
        throw new Error('Failed to start design creation job');
      }
      
      const jobId = startResponse.data.jobId;
      console.log('Design creation job started, jobId:', jobId);
      
      // Step 2: Poll for job completion
      const result = await this.pollJobStatus(jobId, onProgress);
      
      return result;
    } catch (error) {
      console.error('Error creating design from variant:', error);
      
      // Enhanced error messages
      if (error.response?.status === 500) {
        const errorMsg = error.response?.data?.message || error.response?.data?.error || 'Server error';
        throw new Error(`Design creation failed: ${errorMsg}. Please check API configuration and try again.`);
      } else if (error.message?.includes('Network Error')) {
        throw new Error('Network error: Cannot connect to API server. Please check your connection.');
      }
      
      throw error;
    }
  }
}

export default new APIService();
