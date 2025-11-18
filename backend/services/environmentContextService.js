/**
 * Environment Context Service
 * Analyzes Gemini specifications to extract environmental context for lighting and materials
 */

class EnvironmentContextService {
  constructor() {
    // Keywords for context detection
    this.locationKeywords = {
      urban: ['city', 'urban', 'downtown', 'street', 'building', 'skyscraper', 'office', 'commercial'],
      suburban: ['suburban', 'neighborhood', 'residential', 'suburb', 'houses'],
      rural: ['rural', 'countryside', 'farm', 'village', 'pastoral'],
      nature: ['forest', 'park', 'woods', 'nature', 'wilderness', 'mountain', 'field'],
      indoor: ['indoor', 'interior', 'inside', 'room', 'hall', 'space'],
      coastal: ['beach', 'coastal', 'ocean', 'sea', 'harbor', 'pier', 'waterfront'],
      industrial: ['industrial', 'factory', 'warehouse', 'plant', 'facility'],
    };

    this.timeOfDayKeywords = {
      sunrise: ['sunrise', 'dawn', 'early morning'],
      morning: ['morning'],
      noon: ['noon', 'midday', 'mid-day'],
      afternoon: ['afternoon'],
      sunset: ['sunset', 'dusk', 'evening'],
      dusk: ['dusk', 'twilight'],
      night: ['night', 'nighttime', 'midnight'],
    };

    this.weatherKeywords = {
      clear: ['clear', 'sunny', 'bright'],
      cloudy: ['cloudy', 'overcast'],
      rainy: ['rain', 'rainy', 'raining', 'wet'],
      foggy: ['fog', 'foggy', 'mist', 'misty'],
      snowy: ['snow', 'snowy', 'snowing'],
    };

    this.seasonKeywords = {
      spring: ['spring', 'springtime'],
      summer: ['summer', 'summertime'],
      fall: ['fall', 'autumn', 'autumnal'],
      winter: ['winter', 'wintry'],
    };
  }

  /**
   * Analyze specifications to extract environmental context
   */
  analyzeContext(specifications) {
    console.log('🔍 Analyzing environmental context...');

    const context = {
      location: this.detectLocation(specifications),
      timeOfDay: this.detectTimeOfDay(specifications),
      weather: this.detectWeather(specifications),
      season: this.detectSeason(specifications),
    };

    console.log('✅ Environmental context extracted:', context);
    return context;
  }

  /**
   * Detect location type from specifications
   */
  detectLocation(specs) {
    const text = this.extractTextFromSpecs(specs).toLowerCase();

    // Check each location type
    for (const [locationType, keywords] of Object.entries(this.locationKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return locationType;
      }
    }

    // Analyze based on scene structure
    if (specs.scene?.type === 'complex' || specs.objectCount > 5) {
      return 'urban';
    }

    if (specs.environmentalContext?.terrain === 'flat' && 
        specs.environmentalContext?.groundCover === 'grass') {
      return 'nature';
    }

    return 'urban'; // Default
  }

  /**
   * Detect time of day from specifications
   */
  detectTimeOfDay(specs) {
    const text = this.extractTextFromSpecs(specs).toLowerCase();

    // Check environmental context first
    if (specs.environmentalContext?.timeOfDay) {
      const contextTime = specs.environmentalContext.timeOfDay.toLowerCase();
      // Map taxonomy format to our format
      if (contextTime === 'dawn') return 'sunrise';
      if (contextTime === 'day') return 'noon';
      if (contextTime !== 'unspecified') return contextTime;
    }

    // Check keywords
    for (const [timeType, keywords] of Object.entries(this.timeOfDayKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return timeType;
      }
    }

    return 'noon'; // Default to daytime
  }

  /**
   * Detect weather from specifications
   */
  detectWeather(specs) {
    const text = this.extractTextFromSpecs(specs).toLowerCase();

    // Check environmental context
    if (specs.environmentalContext?.climate) {
      const climate = specs.environmentalContext.climate.toLowerCase();
      if (climate.includes('rain')) return 'rainy';
      if (climate.includes('snow')) return 'snowy';
    }

    // Check keywords
    for (const [weatherType, keywords] of Object.entries(this.weatherKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return weatherType;
      }
    }

    return 'clear'; // Default
  }

  /**
   * Detect season from specifications
   */
  detectSeason(specs) {
    const text = this.extractTextFromSpecs(specs).toLowerCase();

    // Check keywords
    for (const [seasonType, keywords] of Object.entries(this.seasonKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return seasonType;
      }
    }

    // Try to infer from other context
    if (specs.environmentalContext?.climate) {
      const climate = specs.environmentalContext.climate;
      if (climate === 'tropical') return 'summer';
      if (climate === 'arctic') return 'winter';
    }

    return 'summer'; // Default
  }

  /**
   * Extract all text from specifications for analysis
   */
  extractTextFromSpecs(specs) {
    let text = '';

    // Add scene description
    if (specs.scene?.style) text += ` ${specs.scene.style}`;
    if (specs.scene?.type) text += ` ${specs.scene.type}`;

    // Add style information
    if (specs.style) {
      text += ` ${specs.style.architectural || ''}`;
      text += ` ${specs.style.theme || ''}`;
      text += ` ${specs.style.period || ''}`;
    }

    // Add element names and features
    if (specs.elements && Array.isArray(specs.elements)) {
      specs.elements.forEach(element => {
        text += ` ${element.name || ''}`;
        if (element.features) {
          text += ` ${element.features.join(' ')}`;
        }
        if (element.materials) {
          text += ` ${element.materials.join(' ')}`;
        }
      });
    }

    // Add environmental context
    if (specs.environmentalContext) {
      const env = specs.environmentalContext;
      text += ` ${env.terrain || ''}`;
      text += ` ${env.groundCover || ''}`;
      text += ` ${env.waterPresence || ''}`;
      text += ` ${env.vegetation || ''}`;
      text += ` ${env.climate || ''}`;
      text += ` ${env.timeOfDay || ''}`;
    }

    return text;
  }

  /**
   * Get environment configuration based on context
   */
  getEnvironmentConfig(context) {
    const { location, timeOfDay, weather, season } = context;

    console.log(`🌍 Generating environment config for ${location} at ${timeOfDay} with ${weather} weather`);

    // Calculate lighting parameters
    const sunIntensity = this.calculateSunIntensity(timeOfDay, weather);
    const ambientIntensity = this.calculateAmbientIntensity(timeOfDay, weather);
    const shadowsEnabled = timeOfDay !== 'night' && weather !== 'foggy';

    return {
      location,
      timeOfDay,
      weather,
      season,
      hdri: {
        // Will be populated by polyhavenService
        url: null,
        intensity: 1.0,
        blur: weather === 'foggy' ? 0.3 : weather === 'cloudy' ? 0.1 : 0.0,
      },
      lighting: {
        sunIntensity,
        ambientIntensity,
        shadowsEnabled,
        shadowQuality: 'high',
      },
      atmosphere: {
        fog: weather === 'foggy',
        fogDensity: weather === 'foggy' ? 0.02 : 0.0,
        skyColor: this.getSkyColor(timeOfDay, weather),
        groundColor: this.getGroundColor(location, season),
      },
    };
  }

  /**
   * Calculate sun intensity based on time and weather
   */
  calculateSunIntensity(timeOfDay, weather) {
    let intensity = 1.0;

    // Base intensity by time
    switch (timeOfDay) {
      case 'sunrise':
      case 'sunset':
        intensity = 0.8;
        break;
      case 'morning':
      case 'afternoon':
        intensity = 1.2;
        break;
      case 'noon':
        intensity = 1.5;
        break;
      case 'dusk':
        intensity = 0.5;
        break;
      case 'night':
        intensity = 0.1;
        break;
    }

    // Adjust for weather
    switch (weather) {
      case 'cloudy':
        intensity *= 0.6;
        break;
      case 'rainy':
        intensity *= 0.4;
        break;
      case 'foggy':
        intensity *= 0.5;
        break;
      case 'snowy':
        intensity *= 0.7;
        break;
    }

    return intensity;
  }

  /**
   * Calculate ambient light intensity
   */
  calculateAmbientIntensity(timeOfDay, weather) {
    let intensity = 0.3;

    if (timeOfDay === 'night') {
      intensity = 0.1;
    } else if (timeOfDay === 'noon') {
      intensity = 0.5;
    }

    if (weather === 'cloudy' || weather === 'overcast') {
      intensity += 0.2; // More diffuse light
    }

    return intensity;
  }

  /**
   * Get sky color based on time and weather
   */
  getSkyColor(timeOfDay, weather) {
    if (weather === 'cloudy' || weather === 'overcast') {
      return '#8899AA';
    }

    switch (timeOfDay) {
      case 'sunrise':
        return '#FF9966';
      case 'morning':
        return '#87CEEB';
      case 'noon':
        return '#87CEEB';
      case 'afternoon':
        return '#87CEEB';
      case 'sunset':
        return '#FF6347';
      case 'dusk':
        return '#4B0082';
      case 'night':
        return '#000033';
      default:
        return '#87CEEB';
    }
  }

  /**
   * Get ground color based on location and season
   */
  getGroundColor(location, season) {
    if (location === 'coastal') {
      return '#DEB887'; // Sand
    }

    if (location === 'nature') {
      if (season === 'winter') {
        return '#FFFFFF'; // Snow
      }
      return '#228B22'; // Green grass
    }

    if (location === 'urban' || location === 'industrial') {
      return '#696969'; // Concrete
    }

    return '#8B7355'; // Default brown earth
  }
}

module.exports = new EnvironmentContextService();
