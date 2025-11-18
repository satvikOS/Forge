const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Wikimedia Commons API Service
 * Provides high-resolution architectural images and historical photos
 * Documentation: https://commons.wikimedia.org/wiki/Commons:API
 */
class WikimediaService {
  constructor() {
    this.enabled = process.env.ENABLE_WIKIMEDIA !== 'false';
    this.baseUrl = 'https://commons.wikimedia.org/w/api.php';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Search for images
   */
  async searchImages(query, limit = 10) {
    if (!this.isEnabled()) {
      console.log('Wikimedia Commons is not enabled, skipping image search');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikimedia_search', { query, limit });
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
          generator: 'search',
          gsrsearch: query,
          gsrnamespace: 6, // File namespace
          gsrlimit: limit,
          prop: 'imageinfo',
          iiprop: 'url|size|mime|extmetadata',
          iiurlwidth: 1024,
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      if (!response.data.query || !response.data.query.pages) {
        console.log('⚠️  Wikimedia Commons: No results found');
        return [];
      }

      const pages = response.data.query.pages;
      const images = Object.values(pages).map(page => this.parseImage(page)).filter(img => img);

      cacheService.setLongTerm(cacheKey, images);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikimedia', Date.now() - startTime, true);

      console.log(`✅ Wikimedia Commons search: ${images.length} images for "${query}"`);
      return images;
    } catch (error) {
      analyticsService.trackAPICall('wikimedia', Date.now() - startTime, false, error);
      console.error('❌ Wikimedia Commons search error:', error.message);
      return null;
    }
  }

  /**
   * Get images for a specific building/landmark
   */
  async getBuildingImages(buildingName, limit = 5) {
    return await this.searchImages(`${buildingName} architecture building`, limit);
  }

  /**
   * Get historical photos
   */
  async getHistoricalPhotos(subject, limit = 5) {
    return await this.searchImages(`${subject} historical photograph`, limit);
  }

  /**
   * Get image details
   */
  async getImageDetails(filename) {
    if (!this.isEnabled()) {
      console.log('Wikimedia Commons is not enabled, skipping image details');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikimedia_image', { filename });
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
          titles: `File:${filename}`,
          prop: 'imageinfo',
          iiprop: 'url|size|mime|extmetadata|commonmetadata',
          iiurlwidth: 2048,
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const pages = response.data.query.pages;
      const page = Object.values(pages)[0];

      if (page.missing) {
        console.log(`⚠️  Wikimedia Commons image not found: ${filename}`);
        return null;
      }

      const data = this.parseImage(page);
      cacheService.setLongTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikimedia', Date.now() - startTime, true);

      console.log(`✅ Wikimedia Commons image details retrieved: ${filename}`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('wikimedia', Date.now() - startTime, false, error);
      console.error('❌ Wikimedia Commons image details error:', error.message);
      return null;
    }
  }

  /**
   * Parse image data
   */
  parseImage(page) {
    if (!page.imageinfo || page.imageinfo.length === 0) {
      return null;
    }

    const info = page.imageinfo[0];
    const metadata = info.extmetadata || {};

    return {
      title: page.title,
      url: info.url,
      thumbUrl: info.thumburl,
      width: info.width,
      height: info.height,
      size: info.size,
      mime: info.mime,
      description: this.extractText(metadata.ImageDescription),
      artist: this.extractText(metadata.Artist),
      credit: this.extractText(metadata.Credit),
      license: this.extractText(metadata.LicenseShortName),
      licenseUrl: this.extractText(metadata.LicenseUrl),
      dateCreated: this.extractText(metadata.DateTimeOriginal),
      categories: metadata.Categories?.value?.split('|') || [],
    };
  }

  /**
   * Extract text from metadata value
   */
  extractText(metadataValue) {
    if (!metadataValue || !metadataValue.value) {
      return null;
    }
    // Remove HTML tags
    return metadataValue.value.replace(/<[^>]+>/g, '').trim();
  }

  /**
   * Get categories for filtering
   */
  async getImageCategories(filename) {
    if (!this.isEnabled()) {
      console.log('Wikimedia Commons is not enabled, skipping categories');
      return null;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          action: 'query',
          titles: `File:${filename}`,
          prop: 'categories',
          cllimit: 50,
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const pages = response.data.query.pages;
      const page = Object.values(pages)[0];

      if (page.missing || !page.categories) {
        return [];
      }

      const categories = page.categories.map(cat => cat.title.replace('Category:', ''));
      analyticsService.trackAPICall('wikimedia', Date.now() - startTime, true);

      return categories;
    } catch (error) {
      analyticsService.trackAPICall('wikimedia', Date.now() - startTime, false, error);
      console.error('❌ Wikimedia Commons categories error:', error.message);
      return null;
    }
  }

  /**
   * Filter images by quality and relevance
   */
  filterHighQuality(images, minWidth = 1024, minHeight = 768) {
    return images.filter(img => 
      img.width >= minWidth && 
      img.height >= minHeight &&
      (img.mime === 'image/jpeg' || img.mime === 'image/png')
    );
  }

  /**
   * Get reference images for texturing
   */
  async getReferenceImages(materialType, limit = 5) {
    const queries = {
      brick: 'brick wall texture architecture',
      concrete: 'concrete texture architecture',
      glass: 'glass facade architecture',
      metal: 'metal texture architecture',
      wood: 'wood texture architecture',
      stone: 'stone texture architecture',
    };

    const query = queries[materialType] || `${materialType} texture`;
    const images = await this.searchImages(query, limit * 2);

    if (!images) {
      return null;
    }

    // Filter for high quality
    return this.filterHighQuality(images, 1024, 768).slice(0, limit);
  }
}

// Export singleton instance
module.exports = new WikimediaService();
