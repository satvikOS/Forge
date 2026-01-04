const axios = require('axios');
const cacheService = require('./cacheService');
const analyticsService = require('./analyticsService');

/**
 * Open-Meteo Weather API Service
 * Provides current weather, historical climate data, and lighting conditions
 * Critical for ultra-realistic environmental rendering
 * Documentation: https://open-meteo.com/en/docs
 */
class WeatherService {
  constructor() {
    this.enabled = process.env.ENABLE_OPEN_METEO !== 'false';
    this.baseUrl = 'https://api.open-meteo.com/v1';
    this.timeout = parseInt(process.env.API_TIMEOUT_MS) || 5000;
  }

  /**
   * Check if service is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get current weather conditions
   */
  async getCurrentWeather(latitude, longitude) {
    if (!this.isEnabled()) {
      console.log('Open-Meteo is not enabled, skipping weather query');
      return null;
    }

    const cacheKey = cacheService.generateKey('weather_current', { latitude, longitude });
    const cached = cacheService.getShortTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      const response = await axios.get(`${this.baseUrl}/forecast`, {
        params: {
          latitude,
          longitude,
          current_weather: true,
          hourly: 'temperature_2m,relative_humidity_2m,precipitation,cloud_cover,visibility,wind_speed_10m',
          timezone: 'auto',
        },
        timeout: this.timeout,
      });

      const data = {
        temperature: response.data.current_weather.temperature,
        temperatureUnit: response.data.current_weather_units?.temperature || '°C',
        windSpeed: response.data.current_weather.windspeed,
        windDirection: response.data.current_weather.winddirection,
        weatherCode: response.data.current_weather.weathercode,
        conditions: this.interpretWeatherCode(response.data.current_weather.weathercode),
        time: response.data.current_weather.time,
        location: { latitude, longitude },
        hourlyForecast: response.data.hourly,
      };

      cacheService.setShortTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('open-meteo', Date.now() - startTime, true);

      console.log(`✅ Current weather: ${data.temperature}${data.temperatureUnit}, ${data.conditions}`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('open-meteo', Date.now() - startTime, false, error);
      console.error('❌ Open-Meteo current weather error:', error.message);
      return null;
    }
  }

  /**
   * Get historical climate data for realistic seasonal patterns
   */
  async getHistoricalClimate(latitude, longitude, month) {
    if (!this.isEnabled()) {
      console.log('Open-Meteo is not enabled, skipping historical climate');
      return null;
    }

    const cacheKey = cacheService.generateKey('weather_historical', { latitude, longitude, month });
    const cached = cacheService.getMediumTerm(cacheKey);
    if (cached) {
      analyticsService.trackCache(true);
      return cached;
    }

    const startTime = Date.now();
    try {
      // Get data from last year for the specified month
      const year = new Date().getFullYear() - 1;
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-28`;

      const response = await axios.get(`${this.baseUrl}/archive`, {
        params: {
          latitude,
          longitude,
          start_date: startDate,
          end_date: endDate,
          daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration',
          timezone: 'auto',
        },
        timeout: this.timeout * 2,
      });

      const daily = response.data.daily;
      const avgTemp = this.calculateAverage([...daily.temperature_2m_max, ...daily.temperature_2m_min]);
      const avgPrecipitation = this.calculateAverage(daily.precipitation_sum);
      const avgSunshine = this.calculateAverage(daily.sunshine_duration);

      const data = {
        month,
        averageTemperature: avgTemp,
        averagePrecipitation: avgPrecipitation,
        averageSunshine: avgSunshine,
        climate: this.determineClimate(avgTemp, avgPrecipitation),
        vegetation: this.suggestVegetation(avgTemp, avgPrecipitation, month),
        location: { latitude, longitude },
      };

      cacheService.setMediumTerm(cacheKey, data);
      analyticsService.trackCache(false);
      analyticsService.trackAPICall('open-meteo', Date.now() - startTime, true);

      console.log(`✅ Historical climate for month ${month}: ${data.climate}`);
      return data;
    } catch (error) {
      analyticsService.trackAPICall('open-meteo', Date.now() - startTime, false, error);
      console.error('❌ Open-Meteo historical climate error:', error.message);
      return null;
    }
  }

  /**
   * Get sun position for accurate lighting (critical for realism)
   */
  async getSunPosition(latitude, longitude, dateTime = new Date()) {
    const data = this.calculateSunPosition(latitude, longitude, dateTime);
    
    console.log(`☀️  Sun position: altitude=${data.altitude.toFixed(2)}°, azimuth=${data.azimuth.toFixed(2)}°`);
    return data;
  }

  /**
   * Calculate sun position using astronomical formulas
   */
  calculateSunPosition(latitude, longitude, date) {
    const lat = latitude * Math.PI / 180;
    const lon = longitude * Math.PI / 180;
    
    // Julian day
    const JD = this.getJulianDay(date);
    const n = JD - 2451545.0;
    
    // Mean longitude
    const L = (280.460 + 0.9856474 * n) % 360;
    
    // Mean anomaly
    const g = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
    
    // Ecliptic longitude
    const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
    
    // Obliquity
    const epsilon = (23.439 - 0.0000004 * n) * Math.PI / 180;
    
    // Right ascension
    const RA = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
    
    // Declination
    const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
    
    // Greenwich mean sidereal time
    const GMST = (6.697375 + 0.0657098242 * n + date.getUTCHours() + date.getUTCMinutes() / 60) % 24;
    const GAST = GMST + (1.915 * Math.sin(g)) / 3600;
    
    // Local sidereal time
    const LST = (GAST * 15 + longitude) * Math.PI / 180;
    
    // Hour angle
    const H = LST - RA;
    
    // Altitude
    const altitude = Math.asin(Math.sin(lat) * Math.sin(delta) + Math.cos(lat) * Math.cos(delta) * Math.cos(H));
    
    // Azimuth
    const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(delta) * Math.cos(lat));
    
    return {
      altitude: altitude * 180 / Math.PI,
      azimuth: (azimuth * 180 / Math.PI + 180) % 360,
      declination: delta * 180 / Math.PI,
      hourAngle: H * 180 / Math.PI,
      timeOfDay: this.determineTimeOfDay(altitude * 180 / Math.PI),
      intensity: Math.max(0, Math.sin(altitude)),
    };
  }

  /**
   * Get Julian day
   */
  getJulianDay(date) {
    const a = Math.floor((14 - (date.getUTCMonth() + 1)) / 12);
    const y = date.getUTCFullYear() + 4800 - a;
    const m = (date.getUTCMonth() + 1) + 12 * a - 3;
    
    return date.getUTCDate() + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045 + 
           (date.getUTCHours() - 12) / 24 + date.getUTCMinutes() / 1440 + date.getUTCSeconds() / 86400;
  }

  /**
   * Determine time of day from sun altitude
   */
  determineTimeOfDay(altitude) {
    if (altitude < -18) return 'night';
    if (altitude < -6) return 'astronomical_twilight';
    if (altitude < 0) return 'nautical_twilight';
    if (altitude < 6) return 'civil_twilight';
    if (altitude < 12) return 'morning';
    if (altitude < 60) return 'day';
    return 'midday';
  }

  /**
   * Get complete lighting conditions for rendering
   */
  async getLightingConditions(latitude, longitude, dateTime = new Date()) {
    const weather = await this.getCurrentWeather(latitude, longitude);
    const sunPosition = await this.getSunPosition(latitude, longitude, dateTime);

    // Calculate ambient light based on weather and sun position
    const cloudCover = weather?.hourlyForecast?.cloud_cover?.[0] || 50;
    const baseIntensity = sunPosition.intensity;
    const cloudFactor = 1 - (cloudCover / 100) * 0.7; // Clouds reduce light by up to 70%
    
    return {
      sun: sunPosition,
      weather: weather?.conditions || 'clear',
      cloudCover,
      ambientIntensity: baseIntensity * cloudFactor,
      directIntensity: baseIntensity * (1 - cloudCover / 100),
      shadowStrength: baseIntensity * (1 - cloudCover / 150),
      skyColor: this.calculateSkyColor(sunPosition.altitude, cloudCover),
      fogDensity: weather?.visibility ? this.calculateFogDensity(weather.visibility) : 0,
      atmosphericScattering: this.calculateScattering(sunPosition.altitude),
    };
  }

  /**
   * Calculate sky color based on sun position
   */
  calculateSkyColor(altitude, cloudCover) {
    // Simplified sky color calculation for rendering
    if (altitude < -6) {
      return { r: 0.05, g: 0.05, b: 0.1 }; // Night sky
    } else if (altitude < 6) {
      // Twilight colors
      const t = (altitude + 6) / 12;
      return {
        r: 0.8 * t + 0.2,
        g: 0.5 * t + 0.1,
        b: 0.7 * t + 0.2,
      };
    } else {
      // Day sky
      const cloudiness = cloudCover / 100;
      return {
        r: 0.53 + cloudiness * 0.2,
        g: 0.81 + cloudiness * 0.1,
        b: 0.92 - cloudiness * 0.2,
      };
    }
  }

  /**
   * Calculate fog density from visibility
   */
  calculateFogDensity(visibilityMeters) {
    if (visibilityMeters > 10000) return 0;
    return 1 - (visibilityMeters / 10000);
  }

  /**
   * Calculate atmospheric scattering
   */
  calculateScattering(altitude) {
    return Math.max(0, 1 - Math.abs(altitude) / 90);
  }

  /**
   * Interpret WMO weather code
   */
  interpretWeatherCode(code) {
    const codes = {
      0: 'clear',
      1: 'mainly_clear',
      2: 'partly_cloudy',
      3: 'overcast',
      45: 'foggy',
      48: 'foggy',
      51: 'light_drizzle',
      53: 'moderate_drizzle',
      55: 'dense_drizzle',
      61: 'light_rain',
      63: 'moderate_rain',
      65: 'heavy_rain',
      71: 'light_snow',
      73: 'moderate_snow',
      75: 'heavy_snow',
      95: 'thunderstorm',
    };
    return codes[code] || 'unknown';
  }

  /**
   * Determine climate type
   */
  determineClimate(avgTemp, avgPrecipitation) {
    if (avgTemp > 25 && avgPrecipitation > 100) return 'tropical';
    if (avgTemp > 20 && avgPrecipitation < 50) return 'arid';
    if (avgTemp > 15 && avgTemp < 25) return 'temperate';
    if (avgTemp < 10 && avgPrecipitation > 50) return 'continental';
    if (avgTemp < 0) return 'polar';
    return 'mediterranean';
  }

  /**
   * Suggest vegetation based on climate
   */
  suggestVegetation(avgTemp, avgPrecipitation, month) {
    const isWinter = month === 12 || month === 1 || month === 2;
    const isSummer = month >= 6 && month <= 8;

    if (avgTemp > 25 && avgPrecipitation > 100) {
      return { type: 'tropical', density: 'high', species: ['palm', 'banana', 'fern'] };
    } else if (avgTemp > 20) {
      return { type: 'subtropical', density: 'medium', species: ['oak', 'pine', 'shrub'] };
    } else if (avgTemp > 10) {
      const deciduous = isWinter ? 'bare' : 'full';
      return { type: 'temperate', density: 'medium', species: ['maple', 'birch', 'elm'], foliage: deciduous };
    } else if (avgTemp > 0) {
      return { type: 'boreal', density: 'low', species: ['spruce', 'pine', 'fir'] };
    } else {
      return { type: 'tundra', density: 'very_low', species: ['moss', 'lichen'] };
    }
  }

  /**
   * Calculate average from array
   */
  calculateAverage(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((sum, val) => sum + (val || 0), 0) / arr.length;
  }
}

// Export singleton instance
module.exports = new WeatherService();
