/**
 * Environmental Composer - Location/weather/environmental composition
 * Composes realistic environmental context including lighting and atmosphere
 */

class EnvironmentalComposer {
  constructor() {
    this.climateDatabase = this.initializeClimateDatabase();
    this.locationDatabase = this.initializeLocationDatabase();
  }

  /**
   * Compose complete environmental context
   */
  async composeEnvironment(location, weather = 'clear', timeOfDay = 'noon') {
    const startTime = Date.now();
    
    // Calculate lighting
    const lighting = await this.calculateLighting(location, timeOfDay);
    
    // Generate atmosphere
    const atmosphere = await this.generateAtmosphere(weather, location);
    
    // Get climate data
    const climate = await this.getClimateData(location);
    
    // Calculate seasonal effects
    const season = this.determineSeason(location);
    
    const processingTime = Date.now() - startTime;
    
    return {
      location,
      weather,
      timeOfDay,
      lighting,
      atmosphere,
      climate,
      season,
      processingTime
    };
  }

  /**
   * Calculate lighting based on location and time
   */
  async calculateLighting(location, timeOfDay = 'noon') {
    // Get approximate latitude/longitude if available
    const coords = this.getCoordinates(location);
    
    // Calculate sun position
    const sunPosition = this.calculateSunPosition(coords, timeOfDay);
    
    // Determine light properties based on time of day
    const lightingProperties = this.getLightingProperties(timeOfDay);
    
    return {
      sunPosition,
      intensity: lightingProperties.intensity, // lux
      colorTemperature: lightingProperties.colorTemperature, // K
      shadows: lightingProperties.shadows,
      ambientOcclusion: lightingProperties.ambientOcclusion,
      timeOfDay,
      skyColor: lightingProperties.skyColor,
      sunColor: lightingProperties.sunColor
    };
  }

  /**
   * Calculate sun position
   */
  calculateSunPosition(coords, timeOfDay) {
    // Simplified sun position calculation
    const timeMap = {
      'dawn': { azimuth: 90, elevation: 5 },
      'morning': { azimuth: 120, elevation: 30 },
      'noon': { azimuth: 180, elevation: 60 },
      'afternoon': { azimuth: 240, elevation: 40 },
      'dusk': { azimuth: 270, elevation: 10 },
      'night': { azimuth: 180, elevation: -30 }
    };
    
    const position = timeMap[timeOfDay] || timeMap['noon'];
    
    // Adjust elevation based on latitude
    if (coords && coords.latitude) {
      const latitudeFactor = Math.abs(coords.latitude) / 90;
      position.elevation *= (1 - latitudeFactor * 0.5);
    }
    
    return position;
  }

  /**
   * Get lighting properties for time of day
   */
  getLightingProperties(timeOfDay) {
    const properties = {
      'dawn': {
        intensity: 10000,
        colorTemperature: 3500,
        shadows: 'long',
        ambientOcclusion: 0.6,
        skyColor: '#FF8C69',
        sunColor: '#FFA500'
      },
      'morning': {
        intensity: 50000,
        colorTemperature: 4500,
        shadows: 'medium',
        ambientOcclusion: 0.4,
        skyColor: '#87CEEB',
        sunColor: '#FFFACD'
      },
      'noon': {
        intensity: 100000,
        colorTemperature: 5500,
        shadows: 'sharp',
        ambientOcclusion: 0.3,
        skyColor: '#00BFFF',
        sunColor: '#FFFFFF'
      },
      'afternoon': {
        intensity: 60000,
        colorTemperature: 5000,
        shadows: 'medium',
        ambientOcclusion: 0.4,
        skyColor: '#87CEEB',
        sunColor: '#FFFACD'
      },
      'dusk': {
        intensity: 5000,
        colorTemperature: 3000,
        shadows: 'long',
        ambientOcclusion: 0.7,
        skyColor: '#FF6347',
        sunColor: '#FF4500'
      },
      'night': {
        intensity: 100,
        colorTemperature: 4000,
        shadows: 'none',
        ambientOcclusion: 0.9,
        skyColor: '#191970',
        sunColor: '#C0C0C0'
      }
    };
    
    return properties[timeOfDay] || properties['noon'];
  }

  /**
   * Generate atmospheric effects
   */
  async generateAtmosphere(weather, location) {
    const weatherEffects = this.getWeatherEffects(weather);
    const urbanFactor = this.getUrbanFactor(location);
    
    return {
      fog: weatherEffects.fog,
      haze: weatherEffects.haze,
      humidity: weatherEffects.humidity,
      visibility: weatherEffects.visibility, // meters
      pollution: urbanFactor,
      precipitation: weatherEffects.precipitation,
      cloudCover: weatherEffects.cloudCover,
      windSpeed: weatherEffects.windSpeed, // m/s
      atmosphericPressure: 101325, // Pa (standard)
      temperature: weatherEffects.temperature // °C
    };
  }

  /**
   * Get weather-specific atmospheric effects
   */
  getWeatherEffects(weather) {
    const effects = {
      'clear': {
        fog: 0.1,
        haze: 0.2,
        humidity: 0.5,
        visibility: 20000,
        precipitation: 0,
        cloudCover: 0.1,
        windSpeed: 3,
        temperature: 20
      },
      'cloudy': {
        fog: 0.2,
        haze: 0.3,
        humidity: 0.7,
        visibility: 15000,
        precipitation: 0,
        cloudCover: 0.7,
        windSpeed: 5,
        temperature: 18
      },
      'foggy': {
        fog: 0.7,
        haze: 0.5,
        humidity: 0.9,
        visibility: 5000,
        precipitation: 0,
        cloudCover: 1.0,
        windSpeed: 2,
        temperature: 15
      },
      'rainy': {
        fog: 0.3,
        haze: 0.4,
        humidity: 0.95,
        visibility: 10000,
        precipitation: 0.5,
        cloudCover: 1.0,
        windSpeed: 8,
        temperature: 16
      },
      'stormy': {
        fog: 0.4,
        haze: 0.3,
        humidity: 1.0,
        visibility: 5000,
        precipitation: 0.9,
        cloudCover: 1.0,
        windSpeed: 15,
        temperature: 14
      },
      'snowy': {
        fog: 0.3,
        haze: 0.2,
        humidity: 0.8,
        visibility: 8000,
        precipitation: 0.6,
        cloudCover: 0.9,
        windSpeed: 6,
        temperature: -2
      }
    };
    
    return effects[weather] || effects['clear'];
  }

  /**
   * Normalize location string for comparison
   */
  normalizeLocationString(location) {
    if (!location) return '';
    return location.toString().toLowerCase();
  }

  /**
   * Get urban pollution factor
   */
  getUrbanFactor(location) {
    if (!location) return 0.1;
    
    const locationStr = this.normalizeLocationString(location);
    
    // Major urban centers
    if (locationStr.includes('city') || locationStr.includes('urban') || 
        locationStr.includes('downtown') || locationStr.includes('metropolitan')) {
      return 0.4;
    }
    
    // Suburban
    if (locationStr.includes('suburb') || locationStr.includes('town')) {
      return 0.2;
    }
    
    // Rural
    return 0.1;
  }

  /**
   * Get climate data for location
   */
  async getClimateData(location) {
    const climateZone = this.determineClimateZone(location);
    
    return {
      zone: climateZone,
      averageTemperature: this.getAverageTemperature(climateZone),
      precipitation: this.getAnnualPrecipitation(climateZone),
      humidity: this.getAverageHumidity(climateZone),
      seasons: this.getSeasons(climateZone),
      extremes: this.getClimateExtremes(climateZone)
    };
  }

  /**
   * Determine climate zone
   */
  determineClimateZone(location) {
    if (!location) return 'temperate';
    
    const locationStr = this.normalizeLocationString(location);
    
    // Simplified climate detection
    if (locationStr.includes('tropic') || locationStr.includes('equator')) return 'tropical';
    if (locationStr.includes('desert') || locationStr.includes('arid')) return 'arid';
    if (locationStr.includes('mediterran')) return 'mediterranean';
    if (locationStr.includes('arctic') || locationStr.includes('polar')) return 'polar';
    
    return 'temperate';
  }

  /**
   * Get average temperature for climate zone
   */
  getAverageTemperature(zone) {
    const temps = {
      'tropical': 27,
      'arid': 25,
      'mediterranean': 18,
      'temperate': 15,
      'polar': -10
    };
    
    return temps[zone] || 15;
  }

  /**
   * Get annual precipitation for climate zone
   */
  getAnnualPrecipitation(zone) {
    const precipitation = {
      'tropical': 2000,
      'arid': 200,
      'mediterranean': 600,
      'temperate': 800,
      'polar': 300
    };
    
    return precipitation[zone] || 800;
  }

  /**
   * Get average humidity for climate zone
   */
  getAverageHumidity(zone) {
    const humidity = {
      'tropical': 0.8,
      'arid': 0.3,
      'mediterranean': 0.6,
      'temperate': 0.7,
      'polar': 0.5
    };
    
    return humidity[zone] || 0.7;
  }

  /**
   * Get seasons for climate zone
   */
  getSeasons(zone) {
    const seasons = {
      'tropical': ['wet', 'dry'],
      'arid': ['hot', 'less_hot'],
      'mediterranean': ['hot_dry', 'mild_wet'],
      'temperate': ['spring', 'summer', 'autumn', 'winter'],
      'polar': ['summer', 'winter']
    };
    
    return seasons[zone] || seasons['temperate'];
  }

  /**
   * Get climate extremes
   */
  getClimateExtremes(zone) {
    const extremes = {
      'tropical': { maxTemp: 35, minTemp: 20, maxWind: 200 }, // cyclones
      'arid': { maxTemp: 50, minTemp: 0, maxWind: 80 },
      'mediterranean': { maxTemp: 40, minTemp: 0, maxWind: 120 },
      'temperate': { maxTemp: 38, minTemp: -20, maxWind: 150 },
      'polar': { maxTemp: 15, minTemp: -60, maxWind: 200 }
    };
    
    return extremes[zone] || extremes['temperate'];
  }

  /**
   * Determine current season
   */
  determineSeason(location) {
    const month = new Date().getMonth(); // 0-11
    const climateZone = this.determineClimateZone(location);
    
    // Simplified seasonal determination
    if (climateZone === 'tropical') {
      return month >= 4 && month <= 9 ? 'wet' : 'dry';
    }
    
    // Northern hemisphere temperate
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'autumn';
    return 'winter';
  }

  /**
   * Get coordinates from location string
   */
  getCoordinates(location) {
    // In production, this would use a geocoding service
    // For now, return null or estimate based on known locations
    if (!location) return { latitude: 40, longitude: -74 }; // Default: NYC
    
    return { latitude: 40, longitude: -74 };
  }

  /**
   * Initialize climate database
   */
  initializeClimateDatabase() {
    return {
      'tropical': { avgTemp: 27, rainfall: 2000 },
      'arid': { avgTemp: 25, rainfall: 200 },
      'temperate': { avgTemp: 15, rainfall: 800 },
      'polar': { avgTemp: -10, rainfall: 300 }
    };
  }

  /**
   * Initialize location database
   */
  initializeLocationDatabase() {
    return {
      'paris': { latitude: 48.8566, longitude: 2.3522, climate: 'temperate' },
      'new_york': { latitude: 40.7128, longitude: -74.0060, climate: 'temperate' },
      'tokyo': { latitude: 35.6762, longitude: 139.6503, climate: 'temperate' }
    };
  }
}

module.exports = EnvironmentalComposer;
