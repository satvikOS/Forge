/**
 * Scene Units System
 * Manages project units, scaling, and grid configuration
 * Provides conversion utilities between different unit systems
 */

class SceneUnitsSystem {
    constructor() {
        // Default settings matching Blender/Cinema 4D
        this.settings = {
            baseUnit: 'meters',           // meters, millimeters, centimeters, feet, inches
            gridScale: 1.0,                // 1.0 = 1 square = 1 base unit
            gridSubdivisions: 10,          // Subdivisions for fine control
            displayUnit: 'meters',         // Unit shown in UI
            sceneScale: 1.0,               // Global scene scale multiplier
            snapEnabled: true,             // Snap to grid
            snapSize: 1.0,                 // Snap increment
        };

        // Unit conversion factors to meters
        this.conversionToMeters = {
            meters: 1.0,
            millimeters: 0.001,
            centimeters: 0.01,
            feet: 0.3048,
            inches: 0.0254,
            kilometers: 1000.0,
        };

        // Unit display names and abbreviations
        this.unitInfo = {
            meters: { name: 'Meters', abbr: 'm', plural: 'Meters' },
            millimeters: { name: 'Millimeters', abbr: 'mm', plural: 'Millimeters' },
            centimeters: { name: 'Centimeters', abbr: 'cm', plural: 'Centimeters' },
            feet: { name: 'Feet', abbr: 'ft', plural: 'Feet' },
            inches: { name: 'Inches', abbr: 'in', plural: 'Inches' },
            kilometers: { name: 'Kilometers', abbr: 'km', plural: 'Kilometers' },
        };

        this.listeners = [];
    }

    /**
     * Set the base unit for the scene
     * @param {string} unit - Unit type (meters, millimeters, etc.)
     */
    setBaseUnit(unit) {
        if (!this.conversionToMeters[unit]) {
            console.error(`Unknown unit: ${unit}`);
            return;
        }

        this.settings.baseUnit = unit;
        this.settings.displayUnit = unit;
        this.notifyListeners('baseUnit', unit);
        console.log(`📏 Base unit changed to: ${this.unitInfo[unit].name}`);
    }

    /**
     * Set grid scale (how many base units per grid square)
     * @param {number} scale - Scale factor
     */
    setGridScale(scale) {
        this.settings.gridScale = Math.max(0.001, scale);
        this.notifyListeners('gridScale', this.settings.gridScale);
        console.log(`📐 Grid scale set to: ${this.settings.gridScale} ${this.settings.baseUnit}`);
    }

    /**
     * Set grid subdivisions
     * @param {number} subdivisions - Number of subdivisions
     */
    setGridSubdivisions(subdivisions) {
        this.settings.gridSubdivisions = Math.max(1, Math.min(100, subdivisions));
        this.notifyListeners('gridSubdivisions', this.settings.gridSubdivisions);
    }

    /**
     * Convert value from one unit to another
     * @param {number} value - Value to convert
     * @param {string} fromUnit - Source unit
     * @param {string} toUnit - Target unit
     * @returns {number} Converted value
     */
    convert(value, fromUnit, toUnit) {
        if (fromUnit === toUnit) return value;

        // Convert to meters first, then to target unit
        const inMeters = value * this.conversionToMeters[fromUnit];
        const result = inMeters / this.conversionToMeters[toUnit];

        return result;
    }

    /**
     * Convert value to base unit
     * @param {number} value - Value in any unit
     * @param {string} fromUnit - Source unit
     * @returns {number} Value in base unit
     */
    toBaseUnit(value, fromUnit) {
        return this.convert(value, fromUnit, this.settings.baseUnit);
    }

    /**
     * Convert value from base unit to target unit
     * @param {number} value - Value in base unit
     * @param {string} toUnit - Target unit
     * @returns {number} Converted value
     */
    fromBaseUnit(value, toUnit) {
        return this.convert(value, this.settings.baseUnit, toUnit);
    }

    /**
     * Get grid size in scene units
     * @returns {number} Grid size
     */
    getGridSize() {
        return this.settings.gridScale;
    }

    /**
     * Get subdivision size (size of smallest grid square)
     * @returns {number} Subdivision size
     */
    getSubdivisionSize() {
        return this.settings.gridScale / this.settings.gridSubdivisions;
    }

    /**
     * Snap value to grid
     * @param {number} value - Value to snap
     * @param {boolean} useSubdivisions - Whether to snap to subdivisions
     * @returns {number} Snapped value
     */
    snapToGrid(value, useSubdivisions = false) {
        if (!this.settings.snapEnabled) return value;

        const snapSize = useSubdivisions
            ? this.getSubdivisionSize()
            : this.settings.snapSize;

        return Math.round(value / snapSize) * snapSize;
    }

    /**
     * Snap a 3D position to grid
     * @param {Object} position - {x, y, z} position
     * @param {boolean} useSubdivisions - Whether to snap to subdivisions
     * @returns {Object} Snapped position
     */
    snapPositionToGrid(position, useSubdivisions = false) {
        return {
            x: this.snapToGrid(position.x, useSubdivisions),
            y: this.snapToGrid(position.y, useSubdivisions),
            z: this.snapToGrid(position.z, useSubdivisions),
        };
    }

    /**
     * Format value for display
     * @param {number} value - Value in base unit
     * @param {number} precision - Decimal places
     * @returns {string} Formatted string with unit
     */
    formatValue(value, precision = 2) {
        const displayValue = this.fromBaseUnit(value, this.settings.displayUnit);
        const unit = this.unitInfo[this.settings.displayUnit].abbr;
        return `${displayValue.toFixed(precision)} ${unit}`;
    }

    /**
     * Get current settings
     * @returns {Object} Current settings
     */
    getSettings() {
        return { ...this.settings };
    }

    /**
     * Get unit information
     * @param {string} unit - Unit type
     * @returns {Object} Unit info
     */
    getUnitInfo(unit) {
        return this.unitInfo[unit];
    }

    /**
     * Get all available units
     * @returns {Array} Array of unit types
     */
    getAvailableUnits() {
        return Object.keys(this.conversionToMeters);
    }

    /**
     * Toggle snap to grid
     * @param {boolean} enabled - Enable/disable snap
     */
    setSnapEnabled(enabled) {
        this.settings.snapEnabled = enabled;
        this.notifyListeners('snapEnabled', enabled);
    }

    /**
     * Set snap size
     * @param {number} size - Snap increment
     */
    setSnapSize(size) {
        this.settings.snapSize = Math.max(0.001, size);
        this.notifyListeners('snapSize', this.settings.snapSize);
    }

    /**
     * Add listener for settings changes
     * @param {Function} callback - Callback function
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * Remove listener
     * @param {Function} callback - Callback function
     */
    removeListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    }

    /**
     * Notify all listeners of changes
     * @param {string} property - Changed property
     * @param {any} value - New value
     */
    notifyListeners(property, value) {
        this.listeners.forEach(listener => {
            try {
                listener(property, value, this.settings);
            } catch (error) {
                console.error('Error in units system listener:', error);
            }
        });
    }

    /**
     * Export settings to JSON
     * @returns {Object} Settings as JSON
     */
    exportSettings() {
        return JSON.parse(JSON.stringify(this.settings));
    }

    /**
     * Import settings from JSON
     * @param {Object} settings - Settings object
     */
    importSettings(settings) {
        Object.assign(this.settings, settings);
        this.notifyListeners('import', this.settings);
        console.log('📥 Units settings imported');
    }

    /**
     * Reset to default settings
     */
    resetToDefaults() {
        this.settings = {
            baseUnit: 'meters',
            gridScale: 1.0,
            gridSubdivisions: 10,
            displayUnit: 'meters',
            sceneScale: 1.0,
            snapEnabled: true,
            snapSize: 1.0,
        };
        this.notifyListeners('reset', this.settings);
        console.log('🔄 Units settings reset to defaults');
    }
}

// Export singleton instance
const sceneUnitsSystem = new SceneUnitsSystem();

export default sceneUnitsSystem;
