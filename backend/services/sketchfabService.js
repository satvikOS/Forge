const axios = require('axios');

/**
 * Sketchfab API Service
 * Provides integration with Sketchfab API v3 for 3D model browsing and embedding
 * Documentation: https://docs.sketchfab.com/data-api/v3/index.html
 */

const SKETCHFAB_API_BASE = 'https://api.sketchfab.com/v3';
const SKETCHFAB_OAUTH_BASE = 'https://sketchfab.com/oauth2';

class SketchfabService {
  constructor() {
    this.apiToken = process.env.SKETCHFAB_API_TOKEN;
    this.clientId = process.env.SKETCHFAB_CLIENT_ID;
    this.clientSecret = process.env.SKETCHFAB_CLIENT_SECRET;
    this.enabled = process.env.SKETCHFAB_ENABLED === 'true';
    this.cache = new Map(); // Simple in-memory cache
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Check if Sketchfab integration is enabled
   */
  isEnabled() {
    return this.enabled && (this.apiToken || (this.clientId && this.clientSecret));
  }

  /**
   * Get authorization headers for API requests
   */
  getHeaders(accessToken = null) {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    } else if (this.apiToken) {
      headers['Authorization'] = `Token ${this.apiToken}`;
    }

    return headers;
  }

  /**
   * Get cached data or fetch from API
   */
  async getCached(key, fetchFn) {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.cacheExpiry) {
      console.log(`Cache hit for key: ${key}`);
      return cached.data;
    }

    console.log(`Cache miss for key: ${key}, fetching...`);
    const data = await fetchFn();
    this.cache.set(key, { data, timestamp: now });
    return data;
  }

  /**
   * Search for models by keywords
   * @param {Object} params - Search parameters
   * @param {string} params.q - Search query
   * @param {string} params.categories - Comma-separated category IDs (architecture, cultural-heritage-history)
   * @param {string} params.sort_by - Sort option (relevance, likes, views, recent)
   * @param {number} params.count - Results per page (default: 24, max: 100)
   * @param {string} params.cursor - Cursor for pagination
   * @param {string} params.licenses - Filter by license types
   */
  async searchModels(params = {}) {
    if (!this.isEnabled()) {
      throw new Error('Sketchfab integration is not enabled');
    }

    const {
      q = 'architecture',
      categories = '',
      sort_by = 'relevance',
      count = 24,
      cursor = null,
      licenses = '',
      archives_flavours = 'true', // Include downloadable models
    } = params;

    const cacheKey = `search:${JSON.stringify(params)}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const queryParams = new URLSearchParams({
          q,
          type: 'models',
          sort_by,
          count: count.toString(),
          archives_flavours,
        });

        if (categories) queryParams.append('categories', categories);
        if (cursor) queryParams.append('cursor', cursor);
        if (licenses) queryParams.append('licenses', licenses);

        const response = await axios.get(
          `${SKETCHFAB_API_BASE}/search?${queryParams.toString()}`,
          { headers: this.getHeaders() }
        );

        return {
          success: true,
          results: response.data.results.cursors.results,
          next: response.data.results.cursors.next,
          previous: response.data.results.cursors.previous,
          count: response.data.count,
        };
      } catch (error) {
        console.error('Error searching Sketchfab models:', error.response?.data || error.message);
        throw new Error(`Failed to search models: ${error.response?.data?.detail || error.message}`);
      }
    });
  }

  /**
   * Get model details by UID
   * @param {string} uid - Sketchfab model UID
   */
  async getModel(uid) {
    if (!this.isEnabled()) {
      throw new Error('Sketchfab integration is not enabled');
    }

    const cacheKey = `model:${uid}`;
    
    return this.getCached(cacheKey, async () => {
      try {
        const response = await axios.get(
          `${SKETCHFAB_API_BASE}/models/${uid}`,
          { headers: this.getHeaders() }
        );

        const model = response.data;
        
        return {
          success: true,
          model: {
            uid: model.uid,
            name: model.name,
            description: model.description,
            embedUrl: `https://sketchfab.com/models/${model.uid}/embed`,
            viewerUrl: `https://sketchfab.com/3d-models/${model.uid}`,
            thumbnails: model.thumbnails,
            author: {
              username: model.user.username,
              displayName: model.user.displayName,
              profileUrl: model.user.profileUrl,
              avatar: model.user.avatar,
            },
            license: model.license,
            tags: model.tags,
            categories: model.categories,
            stats: {
              viewCount: model.viewCount,
              likeCount: model.likeCount,
              commentCount: model.commentCount,
            },
            geometry: {
              vertexCount: model.vertexCount,
              faceCount: model.faceCount,
            },
            isDownloadable: model.isDownloadable,
            createdAt: model.createdAt,
            publishedAt: model.publishedAt,
          },
        };
      } catch (error) {
        console.error('Error fetching Sketchfab model:', error.response?.data || error.message);
        throw new Error(`Failed to fetch model: ${error.response?.data?.detail || error.message}`);
      }
    });
  }

  /**
   * Get user's models
   * @param {string} username - Sketchfab username
   * @param {string} accessToken - OAuth access token
   */
  async getUserModels(username, accessToken = null) {
    if (!this.isEnabled()) {
      throw new Error('Sketchfab integration is not enabled');
    }

    try {
      const response = await axios.get(
        `${SKETCHFAB_API_BASE}/users/${username}/models`,
        { headers: this.getHeaders(accessToken) }
      );

      return {
        success: true,
        models: response.data.results,
        count: response.data.count,
      };
    } catch (error) {
      console.error('Error fetching user models:', error.response?.data || error.message);
      throw new Error(`Failed to fetch user models: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Get user's collections
   * @param {string} username - Sketchfab username
   * @param {string} accessToken - OAuth access token
   */
  async getUserCollections(username, accessToken = null) {
    if (!this.isEnabled()) {
      throw new Error('Sketchfab integration is not enabled');
    }

    try {
      const response = await axios.get(
        `${SKETCHFAB_API_BASE}/users/${username}/collections`,
        { headers: this.getHeaders(accessToken) }
      );

      return {
        success: true,
        collections: response.data.results,
        count: response.data.count,
      };
    } catch (error) {
      console.error('Error fetching user collections:', error.response?.data || error.message);
      throw new Error(`Failed to fetch collections: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Get models from a collection
   * @param {string} collectionUid - Collection UID
   * @param {string} accessToken - OAuth access token
   */
  async getCollectionModels(collectionUid, accessToken = null) {
    if (!this.isEnabled()) {
      throw new Error('Sketchfab integration is not enabled');
    }

    try {
      const response = await axios.get(
        `${SKETCHFAB_API_BASE}/collections/${collectionUid}/models`,
        { headers: this.getHeaders(accessToken) }
      );

      return {
        success: true,
        models: response.data.results,
        count: response.data.count,
      };
    } catch (error) {
      console.error('Error fetching collection models:', error.response?.data || error.message);
      throw new Error(`Failed to fetch collection models: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * OAuth: Get authorization URL
   */
  getAuthorizationUrl(redirectUri, state) {
    if (!this.clientId) {
      throw new Error('Sketchfab OAuth not configured');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state: state,
      scope: 'read', // Can be extended: read, write, etc.
    });

    return `${SKETCHFAB_OAUTH_BASE}/authorize/?${params.toString()}`;
  }

  /**
   * OAuth: Exchange authorization code for access token
   */
  async exchangeCodeForToken(code, redirectUri) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Sketchfab OAuth not configured');
    }

    try {
      const response = await axios.post(
        `${SKETCHFAB_OAUTH_BASE}/token/`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: redirectUri,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return {
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } catch (error) {
      console.error('Error exchanging OAuth code:', error.response?.data || error.message);
      throw new Error(`OAuth token exchange failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * OAuth: Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Sketchfab OAuth not configured');
    }

    try {
      const response = await axios.post(
        `${SKETCHFAB_OAUTH_BASE}/token/`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return {
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } catch (error) {
      console.error('Error refreshing access token:', error.response?.data || error.message);
      throw new Error(`Token refresh failed: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Get current user info (requires OAuth access token)
   */
  async getCurrentUser(accessToken) {
    if (!this.isEnabled()) {
      throw new Error('Sketchfab integration is not enabled');
    }

    try {
      const response = await axios.get(
        `${SKETCHFAB_API_BASE}/me`,
        { headers: this.getHeaders(accessToken) }
      );

      return {
        success: true,
        user: response.data,
      };
    } catch (error) {
      console.error('Error fetching current user:', error.response?.data || error.message);
      throw new Error(`Failed to fetch user info: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache() {
    this.cache.clear();
    console.log('Sketchfab cache cleared');
  }
}

module.exports = new SketchfabService();
