import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Sketchfab API Service for Frontend
 * Provides methods to interact with Sketchfab through our backend API
 */
class SketchfabAPIService {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    this.accessToken = this.loadAccessToken();
  }

  /**
   * Get authorization headers
   */
  getHeaders() {
    const headers = {};
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /**
   * Load access token from localStorage
   */
  loadAccessToken() {
    try {
      return localStorage.getItem('sketchfab_access_token');
    } catch (e) {
      return null;
    }
  }

  /**
   * Save access token to localStorage
   */
  saveAccessToken(token) {
    try {
      if (token) {
        localStorage.setItem('sketchfab_access_token', token);
        this.accessToken = token;
      } else {
        localStorage.removeItem('sketchfab_access_token');
        this.accessToken = null;
      }
    } catch (e) {
      console.error('Failed to save access token:', e);
    }
  }

  /**
   * Get cached data or fetch from API
   */
  getCached(key, fetchFn) {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.cacheExpiry) {
      return Promise.resolve(cached.data);
    }

    return fetchFn().then(data => {
      this.cache.set(key, { data, timestamp: now });
      return data;
    });
  }

  /**
   * Check if Sketchfab is enabled
   */
  async checkStatus() {
    try {
      const response = await axios.get(`${API_BASE_URL}/sketchfab/status`);
      return response.data;
    } catch (error) {
      console.error('Error checking Sketchfab status:', error);
      return { success: false, enabled: false, message: error.message };
    }
  }

  /**
   * Search for models
   * @param {Object} params - Search parameters
   * @param {string} params.query - Search query
   * @param {string} params.category - Category filter
   * @param {string} params.sortBy - Sort option
   * @param {number} params.count - Results per page
   * @param {string} params.cursor - Pagination cursor
   */
  async searchModels(params = {}) {
    const { query = 'architecture', category = '', sortBy = 'relevance', count = 24, cursor = null } = params;

    const cacheKey = `search:${JSON.stringify(params)}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const queryParams = new URLSearchParams({
          q: query,
          sort_by: sortBy,
          count: count.toString(),
        });

        if (category) queryParams.append('categories', category);
        if (cursor) queryParams.append('cursor', cursor);

        const response = await axios.get(
          `${API_BASE_URL}/sketchfab/search?${queryParams.toString()}`
        );
        return response.data;
      } catch (error) {
        console.error('Error searching models:', error);
        throw error;
      }
    });
  }

  /**
   * Get model details
   * @param {string} uid - Model UID
   */
  async getModel(uid) {
    const cacheKey = `model:${uid}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/sketchfab/models/${uid}`);
        return response.data;
      } catch (error) {
        console.error('Error fetching model:', error);
        throw error;
      }
    });
  }

  /**
   * Get user's models
   * @param {string} username - Sketchfab username
   */
  async getUserModels(username) {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/sketchfab/users/${username}/models`,
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching user models:', error);
      throw error;
    }
  }

  /**
   * Get user's collections
   * @param {string} username - Sketchfab username
   */
  async getUserCollections(username) {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/sketchfab/users/${username}/collections`,
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching user collections:', error);
      throw error;
    }
  }

  /**
   * Get models from a collection
   * @param {string} collectionUid - Collection UID
   */
  async getCollectionModels(collectionUid) {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/sketchfab/collections/${collectionUid}/models`,
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching collection models:', error);
      throw error;
    }
  }

  /**
   * OAuth: Get authorization URL
   * @param {string} redirectUri - Redirect URI after authorization
   * @param {string} state - Random state for CSRF protection
   */
  async getAuthorizationUrl(redirectUri, state = null) {
    try {
      const params = new URLSearchParams({ redirect_uri: redirectUri });
      if (state) params.append('state', state);

      const response = await axios.get(`${API_BASE_URL}/sketchfab/oauth/authorize?${params.toString()}`);
      return response.data;
    } catch (error) {
      console.error('Error getting authorization URL:', error);
      throw error;
    }
  }

  /**
   * OAuth: Exchange code for token
   * @param {string} code - Authorization code
   * @param {string} redirectUri - Redirect URI
   */
  async exchangeCodeForToken(code, redirectUri) {
    try {
      const response = await axios.post(`${API_BASE_URL}/sketchfab/oauth/token`, {
        code,
        redirect_uri: redirectUri,
      });

      if (response.data.success && response.data.accessToken) {
        this.saveAccessToken(response.data.accessToken);
        
        // Save refresh token separately if needed
        if (response.data.refreshToken) {
          localStorage.setItem('sketchfab_refresh_token', response.data.refreshToken);
        }
      }

      return response.data;
    } catch (error) {
      console.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  /**
   * OAuth: Refresh access token
   */
  async refreshAccessToken() {
    try {
      const refreshToken = localStorage.getItem('sketchfab_refresh_token');
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await axios.post(`${API_BASE_URL}/sketchfab/oauth/refresh`, {
        refresh_token: refreshToken,
      });

      if (response.data.success && response.data.accessToken) {
        this.saveAccessToken(response.data.accessToken);
        
        if (response.data.refreshToken) {
          localStorage.setItem('sketchfab_refresh_token', response.data.refreshToken);
        }
      }

      return response.data;
    } catch (error) {
      console.error('Error refreshing access token:', error);
      // Clear tokens on refresh failure
      this.logout();
      throw error;
    }
  }

  /**
   * Get current user info
   */
  async getCurrentUser() {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/sketchfab/me`,
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching current user:', error);
      throw error;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.accessToken;
  }

  /**
   * Logout (clear tokens)
   */
  logout() {
    this.saveAccessToken(null);
    localStorage.removeItem('sketchfab_refresh_token');
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

export default new SketchfabAPIService();
