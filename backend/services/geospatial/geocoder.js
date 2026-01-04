
const axios = require('axios');

/**
 * Geocoder Service
 * Resolves location names to coordinates using OpenStreetMap Nominatim
 */
class GeocoderService {
    constructor() {
        this.baseUrl = 'https://nominatim.openstreetmap.org/search';
        this.cache = new Map();
    }

    /**
     * Geocode a location query
     * @param {string} query - Location name (e.g. "Eiffel Tower", "New York")
     * @returns {Promise<Object|null>} - { lat, lon, displayName, type }
     */
    async geocode(query) {
        if (!query) return null;

        // Check cache
        if (this.cache.has(query)) {
            console.log(`[Geocoder] Cache hit for: ${query} `);
            return this.cache.get(query);
        }

        try {
            console.log(`[Geocoder] Resolving: ${query} `);

            const response = await axios.get(this.baseUrl, {
                params: {
                    q: query,
                    format: 'json',
                    limit: 1,
                    addressdetails: 1
                },
                headers: {
                    'User-Agent': 'ArchDisc/1.0 (student@archdisc.ai)' // Required by OSM
                }
            });

            const data = response.data;

            if (data && data.length > 0) {
                const result = data[0];

                const locationData = {
                    lat: parseFloat(result.lat),
                    lon: parseFloat(result.lon),
                    displayName: result.display_name,
                    type: result.type,
                    class: result.class,
                    address: result.address
                };

                // Cache result
                this.cache.set(query, locationData);
                return locationData;
            }

            return null;
        } catch (error) {
            console.error('[Geocoder] Error:', error.message);
            return null;
        }
    }
}

module.exports = new GeocoderService();
