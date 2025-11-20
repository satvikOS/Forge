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
    
    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${API_BASE_URL}/generate/${jobId}`);
        const job = response.data.job;
        
        if (!job) {
          throw new Error('Job not found');
        }
        
        // Reset error counter on successful request
        consecutiveErrors = 0;
        
        // Notify progress callback if provided
        if (onProgress) {
          onProgress({
            status: job.status,
            progress: job.progress,
            stages: job.stages,
          });
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
}

export default new APIService();
