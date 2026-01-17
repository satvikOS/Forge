const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Wikipedia API Service
 * Searches for architectural landmarks and extracts detailed information
 * Documentation: https://www.mediawiki.org/wiki/API:Main_page
 */
class WikipediaService {
  constructor() {
    this.enabled = process.env.ENABLE_WIKIPEDIA !== 'false';
    this.baseUrl = 'https://en.wikipedia.org/w/api.php';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Search for articles
   */
  async search(query, limit = 5) {
    if (!this.isEnabled()) {
      console.log('Wikipedia is not enabled, skipping search');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikipedia_search', { query, limit });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          action: 'query',
          list: 'search',
          srsearch: query,
          srlimit: limit,
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const results = response.data.query.search.map(result => ({
        pageId: result.pageid,
        title: result.title,
        snippet: this.stripHTML(result.snippet),
      }));

      cacheService.setLongTerm(cacheKey, results);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikipedia', Date.now() - startTime, true);

      console.log(`✅ Wikipedia search: ${results.length} results for "${query}"`);
      return results;
    } catch (error) {
      analyticsService.trackAPICall('wikipedia', Date.now() - startTime, false, error);
      console.error('❌ Wikipedia search error:', error.message);
      return null;
    }
  }

  /**
   * Get article content and extract information
   */
  async getArticle(title) {
    if (!this.isEnabled()) {
      console.log('Wikipedia is not enabled, skipping article fetch');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikipedia_article', { title });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          action: 'query',
          prop: 'extracts|info|pageimages|coordinates',
          titles: title,
          exintro: true,
          explaintext: true,
          inprop: 'url',
          piprop: 'thumbnail',
          pithumbsize: 500,
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const pages = response.data.query.pages;
      const page = Object.values(pages)[0];

      if (page.missing) {
        console.log(`⚠️  Wikipedia article not found: ${title}`);
        return null;
      }

      const data = {
        pageId: page.pageid,
        title: page.title,
        extract: page.extract,
        url: page.fullurl,
        thumbnail: page.thumbnail?.source,
        coordinates: page.coordinates?.[0] ? {
          latitude: page.coordinates[0].lat,
          longitude: page.coordinates[0].lon,
        } : null,
      };

      cacheService.setLongTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikipedia', Date.now() - startTime, true);

      console.log(`✅ Wikipedia article retrieved: ${data.title}`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('wikipedia', Date.now() - startTime, false, error);
      console.error('❌ Wikipedia article error:', error.message);
      return null;
    }
  }

  /**
   * Get infobox data (structured information)
   */
  async getInfobox(title) {
    if (!this.isEnabled()) {
      console.log('Wikipedia is not enabled, skipping infobox fetch');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikipedia_infobox', { title });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          action: 'query',
          prop: 'revisions',
          titles: title,
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const pages = response.data.query.pages;
      const page = Object.values(pages)[0];

      if (page.missing || !page.revisions) {
        return null;
      }

      const content = page.revisions[0].slots.main['*'];
      const infobox = this.parseInfobox(content);

      cacheService.setLongTerm(cacheKey, infobox);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikipedia', Date.now() - startTime, true);

      console.log(`✅ Wikipedia infobox parsed: ${Object.keys(infobox).length} fields`);
      return infobox;
    } catch (error) {
      analyticsService.trackAPICall('wikipedia', Date.now() - startTime, false, error);
      console.error('❌ Wikipedia infobox error:', error.message);
      return null;
    }
  }

  /**
   * Search for architectural landmarks
   */
  async searchLandmark(landmarkName) {
    console.log(`🔍 Wikipedia REST: Searching for "${landmarkName}"...`);
    
    try {
      // Wrap in a race with timeout to handle Vercel/serverless environment issues
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Wikipedia API timeout')), 3000)
      );
      
      const fetchPromise = (async () => {
        const searchResults = await this.search(landmarkName + ' architecture building', 3);
        
        if (!searchResults || searchResults.length === 0) {
          console.log('❌ Wikipedia REST: No search results');
          return null;
        }

        console.log(`✅ Wikipedia REST: Found ${searchResults.length} results`);

        // Get detailed info for the top result
        const article = await this.getArticle(searchResults[0].title);
        const infobox = await this.getInfobox(searchResults[0].title);

        const result = {
          ...article,
          infobox,
          dimensions: this.extractDimensions(infobox, article.extract),
          style: this.extractStyle(infobox, article.extract),
          history: this.extractHistory(article.extract),
        };
        
        console.log('✅ Wikipedia REST: Data retrieved successfully');
        return result;
      })();
      
      return await Promise.race([fetchPromise, timeoutPromise]);
      
    } catch (error) {
      console.error('❌ Wikipedia REST API failed:', error.message);
      return null;
    }
  }

  /**
   * Parse infobox from wikitext
   */
  parseInfobox(wikitext) {
    const infobox = {};
    const infoboxMatch = wikitext.match(/\{\{Infobox[^}]*(?:\{\{[^}]*\}\}[^}]*)*\}\}/i);
    
    if (!infoboxMatch) {
      return infobox;
    }

    const lines = infoboxMatch[0].split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*\|\s*(\w+)\s*=\s*(.+)$/);
      if (match) {
        const key = match[1].trim();
        const value = this.cleanWikitext(match[2].trim());
        infobox[key] = value;
      }
    }

    return infobox;
  }

  /**
   * Extract dimensions from text and infobox
   */
  extractDimensions(infobox, text) {
    const dimensions = {};

    // Check infobox first
    if (infobox) {
      ['height', 'width', 'length', 'floor_count', 'floors'].forEach(key => {
        if (infobox[key]) {
          const value = this.parseNumeric(infobox[key]);
          if (value) {
            dimensions[key === 'floor_count' || key === 'floors' ? 'floors' : key] = value;
          }
        }
      });
    }

    // Extract from text using regex
    const heightMatch = text?.match(/(\d+(?:\.\d+)?)\s*(?:m|meters|metres|feet|ft)\s+(?:tall|high)/i);
    if (heightMatch && !dimensions.height) {
      dimensions.height = this.parseNumeric(heightMatch[0]);
    }

    return dimensions;
  }

  /**
   * Extract architectural style
   */
  extractStyle(infobox, text) {
    if (infobox?.architectural_style || infobox?.architecture_style) {
      return this.cleanWikitext(infobox.architectural_style || infobox.architecture_style);
    }

    // Common architectural styles to look for
    const styles = [
      'Gothic', 'Baroque', 'Renaissance', 'Neoclassical', 'Art Deco',
      'Modern', 'Brutalist', 'Victorian', 'Romanesque', 'Byzantine',
    ];

    for (const style of styles) {
      if (text?.includes(style)) {
        return style;
      }
    }

    return null;
  }

  /**
   * Extract historical information
   */
  extractHistory(text) {
    if (!text) return null;

    const yearMatch = text.match(/(?:built|constructed|completed).*?(\d{4})/i);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    return {
      constructionYear: year,
      summary: text.substring(0, 500),
    };
  }

  /**
   * Parse numeric value from string
   */
  parseNumeric(str) {
    const match = str.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * Clean wikitext markup
   */
  cleanWikitext(text) {
    return text
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\{\{[^}]+\}\}/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  /**
   * Strip HTML tags
   */
  stripHTML(html) {
    return html.replace(/<[^>]+>/g, '');
  }
}

// Export singleton instance
module.exports = new WikipediaService();
