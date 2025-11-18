/**
 * Material Library Service
 * Parses AmbientCG CSV, builds searchable material database, and provides smart material matching
 */

const fs = require('fs');
const path = require('path');
const materialConfig = require('../config/materialConfig');

class MaterialLibraryService {
  constructor() {
    this.materials = [];
    this.materialIndex = new Map(); // Fast lookup by ID
    this.typeIndex = new Map(); // Fast lookup by type
    this.cache = new Map(); // Cache frequently used materials
    this.isLoaded = false;
  }

  /**
   * Load and parse AmbientCG CSV database
   */
  async loadDatabase() {
    const csvPath = path.join(__dirname, '../data/ambientcg-materials.csv');
    const indexPath = path.join(__dirname, '../data/ambientcg-index.json');

    // Check if index exists and is newer than CSV
    if (fs.existsSync(indexPath)) {
      try {
        const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        if (indexData.version && indexData.materials) {
          this.materials = indexData.materials;
          this.buildIndices();
          this.isLoaded = true;
          console.log(`✅ Loaded ${this.materials.length} materials from index`);
          return;
        }
      } catch (error) {
        console.warn('Failed to load index, will rebuild:', error.message);
      }
    }

    // Parse CSV if no valid index exists
    if (fs.existsSync(csvPath)) {
      try {
        console.log('📊 Parsing AmbientCG CSV...');
        await this.parseCsv(csvPath);
        
        // Save index for faster loading next time
        this.saveIndex(indexPath);
        console.log(`✅ Loaded ${this.materials.length} materials from CSV`);
        this.isLoaded = true;
      } catch (error) {
        console.error('Failed to parse CSV:', error);
        this.isLoaded = false;
      }
    } else {
      console.warn('⚠️  AmbientCG CSV not found at:', csvPath);
      console.warn('   Material library will use fallback materials only');
      this.isLoaded = false;
    }
  }

  /**
   * Parse CSV file and build material database
   */
  async parseCsv(csvPath) {
    const csvData = fs.readFileSync(csvPath, 'utf8');
    const lines = csvData.split('\n');
    
    if (lines.length < 2) {
      throw new Error('CSV file is empty or invalid');
    }

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim());
    const columnMap = materialConfig.csvColumns;

    // Find column indices
    const idIndex = headers.indexOf(columnMap.id);
    const nameIndex = headers.indexOf(columnMap.name);
    const typeIndex = headers.indexOf(columnMap.type);
    const tagsIndex = headers.indexOf(columnMap.tags);
    const resolutionIndex = headers.indexOf(columnMap.resolution);
    const downloadUrlIndex = headers.indexOf(columnMap.downloadUrl);
    const previewUrlIndex = headers.indexOf(columnMap.previewUrl);

    if (idIndex === -1 || nameIndex === -1) {
      throw new Error('Required CSV columns not found');
    }

    // Parse each material
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = this.parseCsvLine(line);
      if (columns.length < 2) continue;

      const material = {
        id: columns[idIndex] || `material_${i}`,
        name: columns[nameIndex] || 'Unknown',
        type: this.normalizeMaterialType(columns[typeIndex] || 'default'),
        tags: tagsIndex >= 0 ? (columns[tagsIndex] || '').split(';').map(t => t.trim()) : [],
        resolution: resolutionIndex >= 0 ? columns[resolutionIndex] : '2K',
        downloadUrl: downloadUrlIndex >= 0 ? columns[downloadUrlIndex] : '',
        previewUrl: previewUrlIndex >= 0 ? columns[previewUrlIndex] : '',
      };

      // Generate texture map URLs
      material.maps = this.generateTextureUrls(material);
      
      this.materials.push(material);
    }

    this.buildIndices();
  }

  /**
   * Parse CSV line handling quoted values
   */
  parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * Normalize material type to standard names
   */
  normalizeMaterialType(rawType) {
    const lowerType = rawType.toLowerCase();
    
    // Check each material type mapping
    for (const [standardType, variations] of Object.entries(materialConfig.materialTypes)) {
      if (variations.some(v => lowerType.includes(v))) {
        return standardType;
      }
    }
    
    return 'default';
  }

  /**
   * Generate texture map URLs from material info
   */
  generateTextureUrls(material) {
    if (!material.downloadUrl) return null;

    const baseUrl = 'https://ambientcg.com/get?file=';
    const materialId = material.id;
    const resolution = material.resolution || '2K';

    return {
      albedo: `${baseUrl}${materialId}_${resolution}-JPG/${materialId}_${resolution}_Color.jpg`,
      normal: `${baseUrl}${materialId}_${resolution}-JPG/${materialId}_${resolution}_NormalGL.jpg`,
      roughness: `${baseUrl}${materialId}_${resolution}-JPG/${materialId}_${resolution}_Roughness.jpg`,
      metalness: `${baseUrl}${materialId}_${resolution}-JPG/${materialId}_${resolution}_Metalness.jpg`,
      ao: `${baseUrl}${materialId}_${resolution}-JPG/${materialId}_${resolution}_AmbientOcclusion.jpg`,
      displacement: `${baseUrl}${materialId}_${resolution}-JPG/${materialId}_${resolution}_Displacement.jpg`,
    };
  }

  /**
   * Build indices for fast lookup
   */
  buildIndices() {
    this.materialIndex.clear();
    this.typeIndex.clear();

    this.materials.forEach(material => {
      // ID index
      this.materialIndex.set(material.id, material);

      // Type index
      if (!this.typeIndex.has(material.type)) {
        this.typeIndex.set(material.type, []);
      }
      this.typeIndex.get(material.type).push(material);
    });
  }

  /**
   * Save index to JSON for faster loading
   */
  saveIndex(indexPath) {
    try {
      const indexData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        materials: this.materials,
      };
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
      console.log('💾 Saved material index');
    } catch (error) {
      console.error('Failed to save index:', error);
    }
  }

  /**
   * Get material for specific surface type with smart matching
   */
  getMaterialForSurface(surfaceType, finish = 'rough', resolution = '2K') {
    if (!this.isLoaded) {
      return this.getFallbackMaterial(surfaceType);
    }

    // Check cache first
    const cacheKey = `${surfaceType}_${finish}_${resolution}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Normalize surface type
    const normalizedType = this.normalizeMaterialType(surfaceType);
    
    // Get materials of this type
    const typeMaterials = this.typeIndex.get(normalizedType) || [];
    
    if (typeMaterials.length === 0) {
      return this.getFallbackMaterial(surfaceType);
    }

    // Score and rank materials based on finish and resolution
    const scored = typeMaterials.map(material => {
      let score = 0;
      
      // Match finish
      const finishVariations = materialConfig.finishTypes[finish] || [];
      const materialName = material.name.toLowerCase();
      const materialTags = material.tags.map(t => t.toLowerCase());
      
      if (finishVariations.some(fv => 
        materialName.includes(fv) || materialTags.some(tag => tag.includes(fv))
      )) {
        score += 10;
      }
      
      // Match resolution
      if (material.resolution === resolution) {
        score += 5;
      }
      
      return { material, score };
    });

    // Sort by score and pick best match
    scored.sort((a, b) => b.score - a.score);
    const bestMatch = scored[0].material;

    // Enhance with properties
    const enhancedMaterial = {
      ...bestMatch,
      type: normalizedType,
      finish,
      properties: this.getMaterialProperties(normalizedType, finish),
    };

    // Cache result
    this.cache.set(cacheKey, enhancedMaterial);
    
    // Limit cache size
    if (this.cache.size > materialConfig.performance.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    return enhancedMaterial;
  }

  /**
   * Get material properties based on type and finish
   */
  getMaterialProperties(type, finish) {
    const baseProperties = materialConfig.fallbackMaterials[type]?.properties || 
                          materialConfig.fallbackMaterials.default.properties;

    // Adjust roughness based on finish
    const adjustedProperties = { ...baseProperties };
    
    if (finish === 'polished') {
      adjustedProperties.roughness = Math.max(0.1, baseProperties.roughness - 0.4);
    } else if (finish === 'weathered') {
      adjustedProperties.roughness = Math.min(1.0, baseProperties.roughness + 0.2);
    }

    return adjustedProperties;
  }

  /**
   * Search materials with filters
   */
  searchMaterials(query, filters = {}) {
    if (!this.isLoaded) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    let results = this.materials;

    // Text search
    if (query) {
      results = results.filter(material => 
        material.name.toLowerCase().includes(lowerQuery) ||
        material.type.toLowerCase().includes(lowerQuery) ||
        material.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }

    // Type filter
    if (filters.type) {
      results = results.filter(material => material.type === filters.type);
    }

    // Resolution filter
    if (filters.resolution) {
      results = results.filter(material => material.resolution === filters.resolution);
    }

    // Finish filter (match tags)
    if (filters.finish) {
      const finishVariations = materialConfig.finishTypes[filters.finish] || [];
      results = results.filter(material => 
        finishVariations.some(fv => 
          material.name.toLowerCase().includes(fv) ||
          material.tags.some(tag => tag.toLowerCase().includes(fv))
        )
      );
    }

    return results;
  }

  /**
   * Get material by ID
   */
  getMaterialById(id) {
    if (!this.isLoaded) {
      return null;
    }
    return this.materialIndex.get(id) || null;
  }

  /**
   * Get fallback material when database not available
   */
  getFallbackMaterial(surfaceType) {
    const normalizedType = this.normalizeMaterialType(surfaceType);
    const fallback = materialConfig.fallbackMaterials[normalizedType] || 
                    materialConfig.fallbackMaterials.default;
    
    return {
      ...fallback,
      id: `fallback_${normalizedType}`,
      name: `Fallback ${normalizedType}`,
      isFallback: true,
    };
  }

  /**
   * Get all available material types
   */
  getMaterialTypes() {
    if (!this.isLoaded) {
      return Object.keys(materialConfig.fallbackMaterials);
    }
    return Array.from(this.typeIndex.keys());
  }

  /**
   * Get database statistics
   */
  getStats() {
    return {
      loaded: this.isLoaded,
      totalMaterials: this.materials.length,
      materialTypes: this.typeIndex.size,
      cacheSize: this.cache.size,
    };
  }
}

module.exports = new MaterialLibraryService();
