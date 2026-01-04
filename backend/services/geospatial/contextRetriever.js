const axios = require('axios');

/**
 * Context Retriever Service
 * Fetches environmental context (weather, elevation, terrain) for coordinates
 */
class ContextRetriever {
    constructor() {
        this.weatherUrl = 'https://api.open-meteo.com/v1/forecast';
    }

    /**
     * Get full context for a location
     * @param {Object} location - { lat, lon }
     * @returns {Promise<Object>} - Context data
     */
    async getContext(location) {
        if (!location || !location.lat || !location.lon) return {};

        console.log(`[ContextRetriever] Fetching context for ${location.lat}, ${location.lon}`);

        const [weather, elevation] = await Promise.all([
            this.getWeather(location),
            this.getElevation(location)
        ]);

        return {
            weather,
            elevation,
            terrain: this.estimateTerrainType(elevation, weather),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Fetch current weather from OpenMeteo
     */
    async getWeather(location) {
        try {
            const response = await axios.get(this.weatherUrl, {
                params: {
                    latitude: location.lat,
                    longitude: location.lon,
                    current: 'temperature_2m,rain,snowfall,cloud_cover,wind_speed_10m',
                    timezone: 'auto'
                }
            });

            const data = response.data;

            if (data.current) {
                return {
                    temperature: data.current.temperature_2m,
                    condition: this.interpretWeatherCode(data.current),
                    isRaining: data.current.rain > 0,
                    isSnowing: data.current.snowfall > 0,
                    cloudCover: data.current.cloud_cover,
                    windSpeed: data.current.wind_speed_10m
                };
            }
            return null;
        } catch (error) {
            console.warn('[ContextRetriever] Weather fetch failed:', error.message);
            return { condition: 'unknown', temperature: 20 }; // Fallback
        }
    }

    /**
     * Get elevation (Simulated for strictly free tier robustness, 
     * but could connect to OpenTopoData)
     */
    async getElevation(location) {
        // For now, return a placeholder or implement OpenTopoData if robust
        // This is a "Shadow" integration, so we don't need pixel-perfect elevation yet,
        // just a general idea.
        return {
            amount: 0, // Default to sea level if unknown
            unit: 'm'
        };
    }

    /**
     * Interpret weather data to simple string
     */
    interpretWeatherCode(current) {
        if (current.snowfall > 0) return 'snowy';
        if (current.rain > 0) return 'rainy';
        if (current.cloud_cover > 70) return 'cloudy';
        return 'sunny';
    }

    /**
     * Estimate terrain type based on data
     */
    estimateTerrainType(elevation, weather) {
        // Simple heuristic
        if (weather && weather.condition === 'snowy') return 'alpine';
        // Could accept user input or advanced map APIs here
        return 'urban'; // Default
    }
}

module.exports = new ContextRetriever();
