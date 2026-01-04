const axios = require('axios');

/**
 * Real-World Reference System
 * Fetches Wikipedia and Wikidata information for ultra-realistic 3D generation
 * Provides structured real-world data including dimensions, materials, and historical context
 */
class RealWorldReferenceSystem {
  constructor() {
    this.enabled = process.env.ENABLE_REFERENCE_SYSTEM !== 'false';
    this.cacheEnabled = process.env.CACHE_REFERENCE_DATA !== 'false';
    this.cache = new Map();
    this.timeout = parseInt(process.env.API_TIMEOUT_MS, 10) || 10000;

    this.wikipediaBaseUrl = 'https://en.wikipedia.org/w/api.php';
    this.wikidataBaseUrl = 'https://www.wikidata.org/w/api.php';
    this.wikidataSparqlUrl = 'https://query.wikidata.org/sparql';

    console.log('✅ Real-World Reference System initialized', {
      enabled: this.enabled,
      cacheEnabled: this.cacheEnabled,
      timeout: this.timeout,
    });
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Fetch comprehensive real-world data for a subject
   * @param {string} subject - The landmark, building, or object to fetch data for
   * @returns {Promise<object>} - Structured real-world reference data
   */
  async fetchReferenceData(subject) {
    if (!this.isEnabled()) {
      console.log('Real-World Reference System is disabled');
      return null;
    }

    console.log(`\n🔍 Fetching real-world data for: "${subject}"`);

    // Check cache first
    if (this.cacheEnabled && this.cache.has(subject)) {
      console.log('✅ Using cached reference data');
      return this.cache.get(subject);
    }

    try {
      const startTime = Date.now();

      // Fetch data from multiple sources in parallel
      const [wikipediaData, wikidataData] = await Promise.all([
        this.fetchWikipediaData(subject).catch(err => {
          console.warn('Wikipedia fetch failed:', err.message);
          return null;
        }),
        this.fetchWikidataData(subject).catch(err => {
          console.warn('Wikidata fetch failed:', err.message);
          return null;
        }),
      ]);

      let referenceData = {
        subject,
        wikipedia: wikipediaData,
        wikidata: wikidataData,
        fetchedAt: new Date().toISOString(),
        fetchTime: Date.now() - startTime,
      };

      // Enrich with geospatial context (Shadow Integration)
      referenceData = await this.enrichWithGeospatialData(referenceData);

      // Cache the result
      if (this.cacheEnabled) {
        this.cache.set(subject, referenceData);
      }

      console.log(`✅ Reference data fetched in ${referenceData.fetchTime}ms`);
      return referenceData;
    } catch (error) {
      console.error('❌ Failed to fetch reference data:', error.message);
      return null;
    }
  }

  /**
   * Fetch Wikipedia article data
   */
  async fetchWikipediaData(subject) {
    console.log('📚 Fetching Wikipedia data...');

    try {
      // First, search for the article
      const searchResponse = await axios.get(this.wikipediaBaseUrl, {
        params: {
          action: 'query',
          list: 'search',
          srsearch: subject,
          srlimit: 1,
          format: 'json',
          origin: '*',
        },
        headers: { 'User-Agent': 'ArchDisc/1.0 (student@archdisc.ai)' },
        timeout: this.timeout,
      });

      const searchResults = searchResponse.data?.query?.search;
      if (!searchResults || searchResults.length === 0) {
        console.log('No Wikipedia articles found');
        return null;
      }

      const pageTitle = searchResults[0].title;
      const pageId = searchResults[0].pageid;

      // Fetch article details (extract + images + infobox)
      const detailsResponse = await axios.get(this.wikipediaBaseUrl, {
        params: {
          action: 'query',
          pageids: pageId,
          prop: 'extracts|pageimages|revisions',
          exintro: true,
          explaintext: true,
          piprop: 'thumbnail|original',
          pithumbsize: 500,
          rvprop: 'content',
          rvslots: 'main',
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const page = detailsResponse.data?.query?.pages?.[pageId];
      if (!page) {
        console.log('Failed to fetch Wikipedia page details');
        return null;
      }

      // Extract infobox data if available
      const infobox = this.extractInfoboxData(page.revisions?.[0]?.slots?.main?.['*']);

      return {
        title: page.title,
        pageId,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        summary: page.extract,
        thumbnail: page.thumbnail?.source,
        image: page.original?.source,
        infobox,
      };
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.error('Wikipedia request timeout');
      } else {
        console.error('Wikipedia API error:', error.message);
      }
      return null;
    }
  }

  /**
   * Extract structured data from Wikipedia infobox
   */
  extractInfoboxData(wikitext) {
    if (!wikitext) return null;

    const infobox = {};

    // Extract height
    const heightMatch = wikitext.match(/\|?\s*height\s*=\s*([^\n|]+)/i);
    if (heightMatch) {
      const heightText = heightMatch[1].trim();
      const heightMeters = this.parseHeightToMeters(heightText);
      if (heightMeters) infobox.height = heightMeters;
    }

    // Extract architect
    const architectMatch = wikitext.match(/\|?\s*architect\s*=\s*([^\n|]+)/i);
    if (architectMatch) {
      infobox.architect = architectMatch[1].trim().replace(/\[\[|\]\]/g, '');
    }

    // Extract completion date
    const completedMatch = wikitext.match(/\|?\s*(?:completion_date|built|opened)\s*=\s*([^\n|]+)/i);
    if (completedMatch) {
      infobox.completionDate = completedMatch[1].trim().replace(/\[\[|\]\]/g, '');
    }

    // Extract location
    const locationMatch = wikitext.match(/\|?\s*location\s*=\s*([^\n|]+)/i);
    if (locationMatch) {
      infobox.location = locationMatch[1].trim().replace(/\[\[|\]\]/g, '');
    }

    return Object.keys(infobox).length > 0 ? infobox : null;
  }

  /**
   * Parse height string to meters
   */
  parseHeightToMeters(heightText) {
    // Try to extract meters
    const metersMatch = heightText.match(/(\d+\.?\d*)\s*(?:m|meters?)/i);
    if (metersMatch) {
      return parseFloat(metersMatch[1]);
    }

    // Try to extract feet and convert
    const feetMatch = heightText.match(/(\d+\.?\d*)\s*(?:ft|feet)/i);
    if (feetMatch) {
      return parseFloat(feetMatch[1]) * 0.3048;
    }

    return null;
  }

  /**
   * Fetch Wikidata structured data
   */
  async fetchWikidataData(subject) {
    console.log('📊 Fetching Wikidata data...');

    try {
      // Search for Wikidata entity
      const searchResponse = await axios.get(this.wikidataBaseUrl, {
        params: {
          action: 'wbsearchentities',
          search: subject,
          language: 'en',
          limit: 1,
          format: 'json',
          origin: '*',
        },
        headers: { 'User-Agent': 'ArchDisc/1.0 (student@archdisc.ai)' },
        timeout: this.timeout,
      });

      const entities = searchResponse.data?.search;
      if (!entities || entities.length === 0) {
        console.log('No Wikidata entities found');
        return null;
      }

      const entityId = entities[0].id;
      const entityLabel = entities[0].label;

      // Fetch entity details
      const entityResponse = await axios.get(this.wikidataBaseUrl, {
        params: {
          action: 'wbgetentities',
          ids: entityId,
          languages: 'en',
          format: 'json',
          origin: '*',
        },
        headers: { 'User-Agent': 'ArchDisc/1.0 (student@archdisc.ai)' },
        timeout: this.timeout,
      });

      const entity = entityResponse.data?.entities?.[entityId];
      if (!entity) {
        console.log('Failed to fetch Wikidata entity details');
        return null;
      }

      // Extract relevant claims (dimensions, materials, etc.)
      const claims = entity.claims || {};
      const dimensions = this.extractDimensions(claims);
      const materials = this.extractMaterials(claims);
      const architect = this.extractArchitect(claims);
      const inceptionDate = this.extractInceptionDate(claims);
      const location = this.extractLocation(claims);

      return {
        entityId,
        label: entityLabel,
        description: entity.descriptions?.en?.value,
        url: `https://www.wikidata.org/wiki/${entityId}`,
        dimensions,
        materials,
        architect,
        inceptionDate,
        location,
      };
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.error('Wikidata request timeout');
      } else {
        console.error('Wikidata API error:', error.message);
      }
      return null;
    }
  }

  /**
   * Extract dimensions from Wikidata claims
   */
  extractDimensions(claims) {
    const dimensions = {};

    // Height (P2048)
    if (claims.P2048 && claims.P2048.length > 0) {
      const heightClaim = claims.P2048[0];
      dimensions.height = parseFloat(heightClaim.mainsnak?.datavalue?.value?.amount);
    }

    // Width (P2049)
    if (claims.P2049 && claims.P2049.length > 0) {
      const widthClaim = claims.P2049[0];
      dimensions.width = parseFloat(widthClaim.mainsnak?.datavalue?.value?.amount);
    }

    // Length (P2043)
    if (claims.P2043 && claims.P2043.length > 0) {
      const lengthClaim = claims.P2043[0];
      dimensions.length = parseFloat(lengthClaim.mainsnak?.datavalue?.value?.amount);
    }

    // Base width (for structures like Eiffel Tower)
    if (claims.P2067 && claims.P2067.length > 0) {
      const baseWidthClaim = claims.P2067[0];
      dimensions.baseWidth = parseFloat(baseWidthClaim.mainsnak?.datavalue?.value?.amount);
    }

    return Object.keys(dimensions).length > 0 ? dimensions : null;
  }

  /**
   * Extract materials from Wikidata claims
   */
  extractMaterials(claims) {
    const materials = [];

    // Material used (P186)
    if (claims.P186 && claims.P186.length > 0) {
      for (const materialClaim of claims.P186) {
        const materialId = materialClaim.mainsnak?.datavalue?.value?.id;
        if (materialId) {
          // For now, just store the ID - could fetch labels in future
          materials.push(materialId);
        }
      }
    }

    return materials.length > 0 ? materials : null;
  }

  /**
   * Extract architect from Wikidata claims
   */
  extractArchitect(claims) {
    // Architect (P84)
    if (claims.P84 && claims.P84.length > 0) {
      const architectClaim = claims.P84[0];
      const architectId = architectClaim.mainsnak?.datavalue?.value?.id;
      return architectId || null;
    }
    return null;
  }

  /**
   * Extract inception date from Wikidata claims
   */
  extractInceptionDate(claims) {
    // Inception (P571)
    if (claims.P571 && claims.P571.length > 0) {
      const inceptionClaim = claims.P571[0];
      const time = inceptionClaim.mainsnak?.datavalue?.value?.time;
      if (time) {
        // Parse time format: +1889-03-31T00:00:00Z
        const year = time.match(/[+-](\d+)-/)?.[1];
        return year || time;
      }
    }
    return null;
  }

  /**
   * Extract location from Wikidata claims
   */
  extractLocation(claims) {
    // Coordinate location (P625)
    if (claims.P625 && claims.P625.length > 0) {
      const locationClaim = claims.P625[0];
      const coords = locationClaim.mainsnak?.datavalue?.value;
      if (coords) {
        return {
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
      }
    }
    return null;
  }

  /**
   * Extract coordinates from prompt text
   * Supports formats like: "40.7589,-73.9851" or "coordinates: 40.7589, -73.9851"
   */
  extractCoordinates(prompt) {
    const coordPattern = /coordinates?:?\s*(-?\d+\.?\d*)\s*,?\s*(-?\d+\.?\d*)/i;
    const match = prompt.match(coordPattern);

    if (match) {
      return {
        latitude: parseFloat(match[1]),
        longitude: parseFloat(match[2]),
      };
    }

    return null;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('✅ Reference data cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      enabled: this.cacheEnabled,
    };
  }

  /**
   * Enrich reference data with geospatial context
   * @param {Object} referenceData - Existing reference data
   */
  async enrichWithGeospatialData(referenceData) {
    if (!referenceData || !referenceData.subject) return referenceData;

    try {
      // 1. Resolve coordinates if not already present
      let location = referenceData.wikidata?.location;

      if (!location) {
        const geocoder = require('../geospatial/geocoder');
        const geoResult = await geocoder.geocode(referenceData.subject);
        if (geoResult) {
          location = { lat: geoResult.lat, lon: geoResult.lon };
          referenceData.geocodedLocation = geoResult;
        }
      }

      // 2. Fetch environmental context
      if (location) {
        const contextRetriever = require('../geospatial/contextRetriever');
        const context = await contextRetriever.getContext(location);
        referenceData.environmentalContext = context;
        console.log(`✅ Added environmental context for ${referenceData.subject}`);
      }

    } catch (error) {
      console.warn('⚠️ Failed to enrich with geospatial data:', error.message);
    }

    return referenceData;
  }
}

module.exports = new RealWorldReferenceSystem();
