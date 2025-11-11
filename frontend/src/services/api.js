import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

class APIService {
  /**
   * Generate design from prompt
   */
  async generateDesign(prompt) {
    try {
      const response = await axios.post(`${API_BASE_URL}/design/generate`, { prompt });
      return response.data;
    } catch (error) {
      console.error('Error generating design:', error);
      throw error;
    }
  }

  /**
   * Generate multiple design proposals (ArchPro feature)
   */
  async generateProposals(prompt, count = 3) {
    try {
      const response = await axios.post(`${API_BASE_URL}/design/proposals`, { prompt, count });
      return response.data;
    } catch (error) {
      console.error('Error generating proposals:', error);
      throw error;
    }
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
}

export default new APIService();
