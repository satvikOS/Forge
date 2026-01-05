/**
 * Configuration & Design Families Service
 * Parametric configurations, design tables, variant management
 * Size families, feature options, configuration-specific properties
 * Automated configuration generation, dependency management
 */

class ConfigurationManagementService {
    constructor() {
        this.configurations = new Map();
        this.designFamilies = new Map();
        this.configTables = new Map();
    }

    /**
     * Create design family with configurations
     */
    async createDesignFamily(spec) {
        const {
            familyName,
            baseModel,
            parameters = [],  // Array of configurable parameters
            configurations = [],  // Predefined configurations
            autoGenerate = false,  // Auto-generate size range
            sizeRange = null,  // For auto-generation
            naming = 'descriptive'  // 'descriptive', 'numeric', 'custom'
        } = spec;

        console.log(`🔧 Design Family: Creating "${familyName}"...`);

        const familyId = `family_${Date.now()}`;

        const family = {
            familyId,
            familyName,
            baseModel,
            parameters,
            configurations: [],
            designTable: null,
            createdAt: Date.now()
        };

        // Auto-generate configurations if requested
        if (autoGenerate && sizeRange) {
            console.log(`  🤖 Auto-generating configurations...`);
            const autoConfigs = this.autoGenerateConfigurations(parameters, sizeRange, naming);
            configurations.push(...autoConfigs);
        }

        // Create each configuration
        for (const configSpec of configurations) {
            const config = await this.createConfiguration(configSpec, family);
            family.configurations.push(config);
        }

        // Generate design table
        family.designTable = this.generateDesignTable(family);

        this.designFamilies.set(familyId, family);

        return {
            success: true,
            operation: 'create-design-family',
            family,
            configurations: family.configurations.length,
            designTable: family.designTable
        };
    }

    /**
     * Create individual configuration
     */
    async createConfiguration(spec, family) {
        const {
            configName,
            description = '',
            parameterValues = {},  // e.g., { diameter: 10, length: 50 }
            suppressedFeatures = [],  // Features to suppress/hide
            customProperties = {},  // Part number, description, material, etc.
            bom = null,  // Configuration-specific BOM
            derivedFrom = null  // Parent configuration
        } = spec;

        console.log(`    ⚙️ Creating configuration: "${configName}"...`);

        const config = {
            configId: `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            configName,
            description,
            familyId: family.familyId,
            parameterValues,
            suppressedFeatures,
            customProperties,
            bom,
            derivedFrom,
            geometry: null,  // Generated geometry
            mass: 0,
            volume: 0,
            surfaceArea: 0,
            createdAt: Date.now()
        };

        // Generate geometry for this configuration
        config.geometry = await this.generateConfigurationGeometry(
            family.baseModel,
            parameterValues,
            suppressedFeatures
        );

        // Calculate properties
        config.mass = this.calculateMass(config.geometry, config.customProperties.material);
        config.volume = this.calculateVolume(config.geometry);
        config.surfaceArea = this.calculateSurfaceArea(config.geometry);

        this.configurations.set(config.configId, config);

        console.log(`      ✅ ${configName}: ${JSON.stringify(parameterValues)}`);

        return config;
    }

    /**
     * Auto-generate configurations
     */
    autoGenerateConfigurations(parameters, sizeRange, naming) {
        const configs = [];

        // Example: Generate size family
        if (sizeRange.type === 'linear') {
            const { start, end, step, parameter } = sizeRange;

            for (let value = start; value <= end; value += step) {
                const configName = naming === 'descriptive'
                    ? `${parameter.toUpperCase()}-${value}`
                    : `Config ${configs.length + 1}`;

                configs.push({
                    configName,
                    description: `${parameter} = ${value}`,
                    parameterValues: { [parameter]: value },
                    customProperties: {
                        partNumber: `PN-${value}`,
                        description: `Size ${value}`
                    }
                });
            }
        } else if (sizeRange.type === 'matrix') {
            // Generate configurations for all combinations of parameters
            const combinations = this.generateParameterCombinations(parameters, sizeRange.values);

            combinations.forEach((combo, index) => {
                const configName = naming === 'descriptive'
                    ? Object.entries(combo).map(([k, v]) => `${k}${v}`).join('-')
                    : `Config ${index + 1}`;

                configs.push({
                    configName,
                    description: JSON.stringify(combo),
                    parameterValues: combo,
                    customProperties: {
                        partNumber: `PN-${index + 1}`
                    }
                });
            });
        }

        console.log(`    ✅ Auto-generated ${configs.length} configurations`);

        return configs;
    }

    /**
     * Generate parameter combinations
     */
    generateParameterCombinations(parameters, valueRanges) {
        const combinations = [];

        const paramNames = Object.keys(valueRanges);

        const generate = (index, current) => {
            if (index === paramNames.length) {
                combinations.push({ ...current });
                return;
            }

            const paramName = paramNames[index];
            const values = valueRanges[paramName];

            for (const value of values) {
                current[paramName] = value;
                generate(index + 1, current);
            }
        };

        generate(0, {});

        return combinations;
    }

    /**
     * Generate configuration geometry
     */
    async generateConfigurationGeometry(baseModel, parameterValues, suppressedFeatures) {
        // Simplified - real implementation would rebuild model with new parameters

        const geometry = {
            baseModel,
            appliedParameters: parameterValues,
            suppressedFeatures,
            vertices: [],
            edges: [],
            faces: []
        };

        // Apply parameter changes
        Object.entries(parameterValues).forEach(([param, value]) => {
            // Real implementation would update actual geometry
            console.log(`        Applying ${param} = ${value}`);
        });

        // Suppress features
        suppressedFeatures.forEach(feature => {
            console.log(`        Suppressing feature: ${feature}`);
        });

        return geometry;
    }

    /**
     * Generate design table
     */
    generateDesignTable(family) {
        console.log(`  📊 Generating design table...`);

        const table = {
            tableId: `table_${family.familyId}`,
            familyId: family.familyId,
            familyName: family.familyName,
            columns: ['Configuration', 'Description', ...family.parameters.map(p => p.name), 'Mass', 'Volume'],
            rows: []
        };

        // Add row for each configuration
        family.configurations.forEach(config => {
            const row = {
                configuration: config.configName,
                description: config.description,
                mass: config.mass.toFixed(2),
                volume: config.volume.toFixed(2)
            };

            // Add parameter values
            family.parameters.forEach(param => {
                row[param.name] = config.parameterValues[param.name] || '-';
            });

            table.rows.push(row);
        });

        console.log(`    ✅ Design table: ${table.rows.length} configurations`);

        return table;
    }

    /**
     * Create derived configuration
     */
    async createDerivedConfiguration(spec) {
        const {
            parentConfigId,
            configName,
            modifiedParameters = {},  // Parameters that differ from parent
            additionalFeatures = [],  // Features to add
            suppressedFeatures = []   // Features to suppress
        } = spec;

        const parent = this.configurations.get(parentConfigId);
        if (!parent) {
            throw new Error(`Parent configuration ${parentConfigId} not found`);
        }

        console.log(`  🔗 Creating derived configuration from "${parent.configName}"...`);

        // Merge parent parameters with modifications
        const parameterValues = {
            ...parent.parameterValues,
            ...modifiedParameters
        };

        const derivedConfig = await this.createConfiguration({
            configName,
            description: `Derived from ${parent.configName}`,
            parameterValues,
            suppressedFeatures: [...parent.suppressedFeatures, ...suppressedFeatures],
            customProperties: { ...parent.customProperties },
            derivedFrom: parentConfigId
        }, { familyId: parent.familyId });

        console.log(`    ✅ Derived configuration created`);

        return {
            success: true,
            operation: 'create-derived-configuration',
            configuration: derivedConfig,
            parent: parent.configName
        };
    }

    /**
     * Switch active configuration
     */
    async switchConfiguration(familyId, configName) {
        const family = this.designFamilies.get(familyId);
        if (!family) {
            throw new Error(`Design family ${familyId} not found`);
        }

        const config = family.configurations.find(c => c.configName === configName);
        if (!config) {
            throw new Error(`Configuration "${configName}" not found in family "${family.familyName}"`);
        }

        console.log(`🔄 Switching to configuration: "${configName}"`);

        // In real implementation, this would update the active model

        return {
            success: true,
            operation: 'switch-configuration',
            activeConfiguration: config,
            parameters: config.parameterValues,
            properties: {
                mass: config.mass,
                volume: config.volume,
                surfaceArea: config.surfaceArea
            }
        };
    }

    /**
     * Compare configurations
     */
    async compareConfigurations(configIds) {
        console.log(`📊 Comparing ${configIds.length} configurations...`);

        const configs = configIds.map(id => this.configurations.get(id));

        if (configs.some(c => !c)) {
            throw new Error('One or more configurations not found');
        }

        const comparison = {
            configurations: configs.map(c => c.configName),
            parameters: {},
            properties: {
                mass: configs.map(c => c.mass),
                volume: configs.map(c => c.volume),
                surfaceArea: configs.map(c => c.surfaceArea)
            },
            differences: []
        };

        // Compare parameter values
        const allParams = new Set();
        configs.forEach(c => {
            Object.keys(c.parameterValues).forEach(param => allParams.add(param));
        });

        allParams.forEach(param => {
            comparison.parameters[param] = configs.map(c => c.parameterValues[param] || '-');

            // Check if parameter differs
            const values = comparison.parameters[param];
            if (new Set(values).size > 1) {
                comparison.differences.push({
                    parameter: param,
                    values: values,
                    range: this.getNumericRange(values)
                });
            }
        });

        console.log(`  ✅ Found ${comparison.differences.length} parameter differences`);

        return {
            success: true,
            operation: 'compare-configurations',
            comparison
        };
    }

    /**
     * Generate configuration matrix
     */
    async generateConfigurationMatrix(spec) {
        const {
            familyId,
            parameters,  // e.g., [{ name: 'diameter', values: [10, 15, 20] }, { name: 'length', values: [50, 75, 100] }]
            naming = 'auto'
        } = spec;

        const family = this.designFamilies.get(familyId);
        if (!family) {
            throw new Error(`Design family ${familyId} not found`);
        }

        console.log(`  🔢 Generating configuration matrix...`);

        // Generate all combinations
        const valueRanges = {};
        parameters.forEach(p => {
            valueRanges[p.name] = p.values;
        });

        const combinations = this.generateParameterCombinations(parameters, valueRanges);

        console.log(`    ✅ Matrix: ${combinations.length} configurations (${parameters.map(p => p.values.length).join(' × ')})`);

        const configs = [];
        for (const combo of combinations) {
            const configName = Object.entries(combo)
                .map(([k, v]) => `${k.charAt(0).toUpperCase()}${v}`)
                .join('-');

            const config = await this.createConfiguration({
                configName,
                parameterValues: combo,
                customProperties: {
                    partNumber: `PN-${configs.length + 1}`
                }
            }, family);

            configs.push(config);
        }

        return {
            success: true,
            operation: 'generate-configuration-matrix',
            configurations: configs,
            matrix: {
                dimensions: parameters.map(p => p.values.length),
                total: combinations.length
            }
        };
    }

    /**
     * Export configuration data
     */
    async exportConfigurationTable(familyId, format = 'CSV') {
        const family = this.designFamilies.get(familyId);
        if (!family) {
            throw new Error(`Design family ${familyId} not found`);
        }

        console.log(`📤 Exporting configuration table to ${format}...`);

        const table = family.designTable;

        let exportData = '';

        if (format === 'CSV') {
            // CSV header
            exportData = table.columns.join(',') + '\n';

            // CSV rows
            table.rows.forEach(row => {
                const values = table.columns.map(col =>
                    row[col.toLowerCase().replace(/ /g, '')] || ''
                );
                exportData += values.join(',') + '\n';
            });
        } else if (format === 'JSON') {
            exportData = JSON.stringify({
                family: family.familyName,
                configurations: table.rows
            }, null, 2);
        } else if (format === 'Excel') {
            exportData = {
                format: 'XLSX',
                sheets: [
                    {
                        name: family.familyName,
                        columns: table.columns,
                        rows: table.rows
                    }
                ]
            };
        }

        return {
            success: true,
            operation: `export-${format.toLowerCase()}`,
            data: exportData,
            downloadUrl: `/api/mechanical/configurations/${familyId}/export.${format.toLowerCase()}`
        };
    }

    // ========== Helper Methods ==========

    calculateMass(geometry, material) {
        // Simplified - real implementation would use actual volume and material density
        const volume = this.calculateVolume(geometry);  // mm³
        const density = this.getMaterialDensity(material);  // g/cm³

        return (volume / 1000) * density;  // grams
    }

    calculateVolume(geometry) {
        // Simplified - real implementation would calculate actual volume
        return 1000;  // mm³
    }

    calculateSurfaceArea(geometry) {
        // Simplified - real implementation would calculate actual surface area
        return 500;  // mm²
    }

    getMaterialDensity(material) {
        const densities = {
            'aluminum': 2.7,
            'steel': 7.85,
            'stainless-steel': 8.0,
            'titanium': 4.5,
            'plastic': 1.2
        };

        return densities[material] || 1.0;
    }

    getNumericRange(values) {
        const numericValues = values.filter(v => typeof v === 'number');
        if (numericValues.length === 0) return null;

        return {
            min: Math.min(...numericValues),
            max: Math.max(...numericValues),
            range: Math.max(...numericValues) - Math.min(...numericValues)
        };
    }
}

module.exports = new ConfigurationManagementService();
