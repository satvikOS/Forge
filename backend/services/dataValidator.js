/**
 * Data Validation & Quality Control Service
 * Validates API responses, checks completeness, verifies accuracy
 * Cross-references between sources and implements confidence scoring
 */
class DataValidator {
  constructor() {
    // Authoritative source rankings (higher = more trusted)
    this.sourceRankings = {
      wikidata: 10,
      wikipedia: 9,
      openstreetmap: 8,
      mapbox: 8,
      'open-elevation': 7,
      'open-meteo': 7,
      mapillary: 6,
      sketchfab: 5,
    };
  }

  /**
   * Validate API response structure and completeness
   */
  validateResponse(apiName, response, schema) {
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
      completeness: 100,
      confidence: 1.0,
    };

    // Check if response exists
    if (!response) {
      validation.valid = false;
      validation.errors.push('Response is null or undefined');
      validation.completeness = 0;
      validation.confidence = 0;
      return validation;
    }

    // Validate against schema if provided
    if (schema) {
      const schemaValidation = this.validateSchema(response, schema);
      validation.errors.push(...schemaValidation.errors);
      validation.warnings.push(...schemaValidation.warnings);
      validation.completeness = schemaValidation.completeness;
      validation.valid = schemaValidation.valid;
    }

    // Calculate confidence based on source ranking
    const sourceRanking = this.sourceRankings[apiName.toLowerCase()] || 5;
    validation.confidence = sourceRanking / 10;

    // Adjust confidence based on completeness
    validation.confidence *= (validation.completeness / 100);

    console.log(`Validation [${apiName}]:`, {
      valid: validation.valid,
      completeness: validation.completeness,
      confidence: validation.confidence.toFixed(2),
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    });

    return validation;
  }

  /**
   * Validate data against schema
   */
  validateSchema(data, schema) {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      completeness: 100,
    };

    if (!schema || !schema.required) {
      return result;
    }

    let missingFields = 0;
    const totalFields = schema.required.length;

    // Check required fields
    for (const field of schema.required) {
      if (!this.hasField(data, field)) {
        missingFields++;
        result.errors.push(`Missing required field: ${field}`);
      }
    }

    // Check optional fields
    if (schema.optional) {
      for (const field of schema.optional) {
        if (!this.hasField(data, field)) {
          result.warnings.push(`Missing optional field: ${field}`);
        }
      }
    }

    result.completeness = ((totalFields - missingFields) / totalFields) * 100;
    result.valid = missingFields === 0;

    return result;
  }

  /**
   * Check if object has nested field
   */
  hasField(obj, fieldPath) {
    const parts = fieldPath.split('.');
    let current = obj;

    for (const part of parts) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        return false;
      }
      current = current[part];
    }

    return current !== null && current !== undefined;
  }

  /**
   * Validate dimensional data (height, width, length)
   */
  validateDimensions(dimensions) {
    const validation = {
      valid: true,
      errors: [],
      normalized: {},
    };

    // Check for required fields
    if (!dimensions) {
      validation.valid = false;
      validation.errors.push('Dimensions object is missing');
      return validation;
    }

    // Validate numeric values
    const fields = ['height', 'width', 'length', 'depth'];
    for (const field of fields) {
      if (field in dimensions) {
        const value = parseFloat(dimensions[field]);
        if (isNaN(value) || value <= 0) {
          validation.errors.push(`Invalid ${field}: ${dimensions[field]}`);
          validation.valid = false;
        } else {
          validation.normalized[field] = value;
        }
      }
    }

    // Sanity checks
    if (validation.normalized.height > 1000) {
      validation.errors.push(`Height seems unrealistic: ${validation.normalized.height}m`);
    }
    if (validation.normalized.width > 1000) {
      validation.errors.push(`Width seems unrealistic: ${validation.normalized.width}m`);
    }

    return validation;
  }

  /**
   * Validate geographic coordinates
   */
  validateCoordinates(coords) {
    const validation = {
      valid: true,
      errors: [],
      normalized: {},
    };

    if (!coords) {
      validation.valid = false;
      validation.errors.push('Coordinates object is missing');
      return validation;
    }

    const lat = parseFloat(coords.latitude || coords.lat);
    const lon = parseFloat(coords.longitude || coords.lon || coords.lng);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      validation.valid = false;
      validation.errors.push(`Invalid latitude: ${lat}`);
    } else {
      validation.normalized.latitude = lat;
    }

    if (isNaN(lon) || lon < -180 || lon > 180) {
      validation.valid = false;
      validation.errors.push(`Invalid longitude: ${lon}`);
    } else {
      validation.normalized.longitude = lon;
    }

    return validation;
  }

  /**
   * Cross-reference data from multiple sources
   */
  crossReference(sources) {
    const result = {
      conflicts: [],
      resolved: {},
      confidence: 1.0,
    };

    if (!sources || sources.length === 0) {
      return result;
    }

    // Group data by field
    const fieldData = {};
    for (const source of sources) {
      for (const [field, value] of Object.entries(source.data)) {
        if (!fieldData[field]) {
          fieldData[field] = [];
        }
        fieldData[field].push({
          value,
          source: source.name,
          ranking: this.sourceRankings[source.name.toLowerCase()] || 5,
        });
      }
    }

    // Resolve conflicts for each field
    for (const [field, values] of Object.entries(fieldData)) {
      if (values.length === 1) {
        // No conflict, single source
        result.resolved[field] = values[0].value;
      } else {
        // Check for conflicts
        const uniqueValues = [...new Set(values.map(v => JSON.stringify(v.value)))];
        if (uniqueValues.length > 1) {
          // Conflict detected
          result.conflicts.push({
            field,
            values: values.map(v => ({
              value: v.value,
              source: v.source,
            })),
          });

          // Resolve by preferring higher-ranked source
          const best = values.reduce((prev, curr) => 
            curr.ranking > prev.ranking ? curr : prev
          );
          result.resolved[field] = best.value;

          console.log(`Conflict resolved for ${field}: using ${best.source} (ranking: ${best.ranking})`);
        } else {
          // All sources agree
          result.resolved[field] = values[0].value;
        }
      }
    }

    // Adjust confidence based on conflicts
    if (result.conflicts.length > 0) {
      result.confidence = Math.max(0.5, 1.0 - (result.conflicts.length * 0.1));
    }

    return result;
  }

  /**
   * Validate building data
   */
  validateBuilding(buildingData) {
    const schema = {
      required: ['name', 'location'],
      optional: ['height', 'width', 'style', 'year'],
    };

    const validation = this.validateResponse('building', buildingData, schema);

    // Additional building-specific validation
    if (buildingData.height) {
      const dimValidation = this.validateDimensions({ height: buildingData.height });
      if (!dimValidation.valid) {
        validation.errors.push(...dimValidation.errors);
        validation.valid = false;
      }
    }

    if (buildingData.location) {
      const coordValidation = this.validateCoordinates(buildingData.location);
      if (!coordValidation.valid) {
        validation.errors.push(...coordValidation.errors);
        validation.valid = false;
      }
    }

    return validation;
  }

  /**
   * Validate weather data
   */
  validateWeather(weatherData) {
    const schema = {
      required: ['temperature', 'conditions'],
      optional: ['humidity', 'windSpeed', 'precipitation', 'sunPosition'],
    };

    const validation = this.validateResponse('weather', weatherData, schema);

    // Temperature sanity check
    if (weatherData.temperature !== undefined) {
      const temp = parseFloat(weatherData.temperature);
      if (temp < -50 || temp > 60) {
        validation.warnings.push(`Temperature seems extreme: ${temp}°C`);
      }
    }

    return validation;
  }

  /**
   * Calculate overall confidence score for orchestrated data
   */
  calculateConfidence(validations) {
    if (!validations || validations.length === 0) {
      return 0;
    }

    const totalConfidence = validations.reduce((sum, v) => sum + (v.confidence || 0), 0);
    const avgConfidence = totalConfidence / validations.length;

    // Penalize if any validation failed
    const failedCount = validations.filter(v => !v.valid).length;
    const penalty = failedCount * 0.1;

    return Math.max(0, Math.min(1, avgConfidence - penalty));
  }
}

// Export singleton instance
module.exports = new DataValidator();
