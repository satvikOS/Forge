const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Wikidata API Service
 * Provides structured architectural data with precise dimensions and metadata
 * Documentation: https://www.wikidata.org/wiki/Wikidata:Data_access
 */
class WikidataService {
  constructor() {
    this.enabled = process.env.ENABLE_WIKIDATA !== 'false';
    this.baseUrl = 'https://www.wikidata.org/w/api.php';
    this.sparqlUrl = 'https://query.wikidata.org/sparql';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Search for entities
   */
  async search(query, limit = 5) {
    if (!this.isEnabled()) {
      console.log('Wikidata is not enabled, skipping search');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikidata_search', { query, limit });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          action: 'wbsearchentities',
          search: query,
          language: 'en',
          limit,
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const results = response.data.search.map(item => ({
        id: item.id,
        label: item.label,
        description: item.description,
        url: item.concepturi,
      }));

      cacheService.setLongTerm(cacheKey, results);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikidata', Date.now() - startTime, true);

      console.log(`✅ Wikidata search: ${results.length} results for "${query}"`);
      return results;
    } catch (error) {
      analyticsService.trackAPICall('wikidata', Date.now() - startTime, false, error);
      console.error('❌ Wikidata search error:', error.message);
      return null;
    }
  }

  /**
   * Get entity data
   */
  async getEntity(entityId) {
    if (!this.isEnabled()) {
      console.log('Wikidata is not enabled, skipping entity fetch');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikidata_entity', { entityId });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          action: 'wbgetentities',
          ids: entityId,
          format: 'json',
          origin: '*',
        },
        timeout: this.timeout,
      });

      const entity = response.data.entities[entityId];
      if (!entity || entity.missing) {
        console.log(`⚠️  Wikidata entity not found: ${entityId}`);
        return null;
      }

      const data = this.parseEntity(entity);
      cacheService.setLongTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikidata', Date.now() - startTime, true);

      console.log(`✅ Wikidata entity retrieved: ${data.label}`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('wikidata', Date.now() - startTime, false, error);
      console.error('❌ Wikidata entity error:', error.message);
      return null;
    }
  }

  /**
   * Get building data with dimensions
   */
  async getBuildingData(buildingName) {
    if (!this.isEnabled()) {
      console.log('Wikidata is not enabled, skipping building data fetch');
      return null;
    }
    
    const searchResults = await this.search(buildingName, 3);
    
    if (!searchResults || searchResults.length === 0) {
      return null;
    }

    // Get detailed data for top result
    const entity = await this.getEntity(searchResults[0].id);
    
    if (!entity) {
      return null;
    }

    return {
      ...entity,
      dimensions: this.extractDimensions(entity.claims),
      coordinates: this.extractCoordinates(entity.claims),
      dates: this.extractDates(entity.claims),
      style: this.extractStyle(entity.claims),
      architect: this.extractArchitect(entity.claims),
    };
  }

  /**
   * Parse entity data
   */
  parseEntity(entity) {
    return {
      id: entity.id,
      label: entity.labels?.en?.value || 'Unknown',
      description: entity.descriptions?.en?.value,
      aliases: entity.aliases?.en?.map(a => a.value) || [],
      claims: entity.claims || {},
      sitelinks: entity.sitelinks || {},
    };
  }

  /**
   * Extract dimensions from claims
   */
  extractDimensions(claims) {
    const dimensions = {};

    // P2048: height
    if (claims.P2048) {
      dimensions.height = this.extractQuantity(claims.P2048[0]);
    }

    // P2049: width
    if (claims.P2049) {
      dimensions.width = this.extractQuantity(claims.P2049[0]);
    }

    // P2043: length
    if (claims.P2043) {
      dimensions.length = this.extractQuantity(claims.P2043[0]);
    }

    // P1101: floors above ground
    if (claims.P1101) {
      dimensions.floors = this.extractQuantity(claims.P1101[0]);
    }

    return dimensions;
  }

  /**
   * Extract coordinates
   */
  extractCoordinates(claims) {
    // P625: coordinate location
    if (claims.P625 && claims.P625[0]) {
      const coord = claims.P625[0].mainsnak.datavalue?.value;
      if (coord) {
        return {
          latitude: coord.latitude,
          longitude: coord.longitude,
        };
      }
    }
    return null;
  }

  /**
   * Extract dates
   */
  extractDates(claims) {
    const dates = {};

    // P571: inception (construction start)
    if (claims.P571) {
      dates.inception = this.extractTime(claims.P571[0]);
    }

    // P576: dissolved, abolished or demolished
    if (claims.P576) {
      dates.demolished = this.extractTime(claims.P576[0]);
    }

    // P1619: date of official opening
    if (claims.P1619) {
      dates.opened = this.extractTime(claims.P1619[0]);
    }

    return dates;
  }

  /**
   * Extract architectural style
   */
  extractStyle(claims) {
    // P149: architectural style
    if (claims.P149 && claims.P149[0]) {
      const styleId = claims.P149[0].mainsnak.datavalue?.value?.id;
      return styleId; // Could be resolved to label with another API call
    }
    return null;
  }

  /**
   * Extract architect
   */
  extractArchitect(claims) {
    // P84: architect
    if (claims.P84 && claims.P84[0]) {
      const architectId = claims.P84[0].mainsnak.datavalue?.value?.id;
      return architectId; // Could be resolved to name with another API call
    }
    return null;
  }

  /**
   * Extract quantity value
   */
  extractQuantity(claim) {
    const value = claim.mainsnak.datavalue?.value;
    if (value && typeof value === 'object') {
      return {
        amount: parseFloat(value.amount),
        unit: value.unit,
      };
    }
    return null;
  }

  /**
   * Extract time value
   */
  extractTime(claim) {
    const value = claim.mainsnak.datavalue?.value;
    if (value && value.time) {
      // Parse ISO 8601 date
      const match = value.time.match(/([+-]?\d+)-(\d{2})-(\d{2})/);
      if (match) {
        return {
          year: parseInt(match[1]),
          month: parseInt(match[2]),
          day: parseInt(match[3]),
          precision: value.precision,
        };
      }
    }
    return null;
  }

  /**
   * Query using SPARQL (for complex queries)
   */
  async sparqlQuery(query) {
    if (!this.isEnabled()) {
      console.log('Wikidata is not enabled, skipping SPARQL query');
      return null;
    }

    const cacheKey = cacheService.generateKey('wikidata_sparql', { query });
    const cached = await cacheService.getLongTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(this.sparqlUrl, {
        params: {
          query,
          format: 'json',
        },
        headers: {
          'Accept': 'application/sparql-results+json',
        },
        timeout: this.timeout * 2,
      });

      const data = response.data.results.bindings;
      cacheService.setLongTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('wikidata', Date.now() - startTime, true);

      console.log(`✅ Wikidata SPARQL query: ${data.length} results`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('wikidata', Date.now() - startTime, false, error);
      console.error('❌ Wikidata SPARQL error:', error.message);
      return null;
    }
  }

  /**
   * Get buildings by architectural style
   */
  async getBuildingsByStyle(styleName, limit = 10) {
    const query = `
      SELECT ?building ?buildingLabel ?height ?width ?coordinates WHERE {
        ?style rdfs:label "${styleName}"@en.
        ?building wdt:P149 ?style.
        ?building wdt:P31 wd:Q41176.
        OPTIONAL { ?building wdt:P2048 ?height. }
        OPTIONAL { ?building wdt:P2049 ?width. }
        OPTIONAL { ?building wdt:P625 ?coordinates. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
      LIMIT ${limit}
    `;

    return await this.sparqlQuery(query);
  }
}

// Export singleton instance
module.exports = new WikidataService();
