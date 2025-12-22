/**
 * Configuration Management Service
 * Handles design configurations, parameter tables, and product families
 */

class ConfigurationService {
    constructor() {
        this.configurations = new Map();
        this.designTables = new Map();
    }

    /**
     * Create a new configuration from a part/assembly
     */
    createConfiguration(model, configName, parameters = {}) {
        const config = {
            id: `config_${Date.now()}`,
            modelId: model.id,
            name: configName,
            parameters: parameters,
            suppressed: false,
            createdAt: new Date().toISOString(),
            description: '',
            thumbnail: null
        };

        // Store configuration
        if (!this.configurations.has(model.id)) {
            this.configurations.set(model.id, new Map());
        }

        this.configurations.get(model.id).set(config.id, config);

        return config;
    }

    /**
     * Create design table for managing multiple configurations
     */
    createDesignTable(model, options = {}) {
        const table = {
            id: `table_${Date.now()}`,
            modelId: model.id,
            name: options.name || 'DesignTable1',
            columns: [], // Parameter names
            rows: [], // Configuration instances
            activeRow: 0,
            linkedFile: null // Excel/CSV file path
        };

        // Add default parameters as columns
        if (model.parameters) {
            table.columns = Object.keys(model.parameters).map(paramName => ({
                name: paramName,
                type: typeof model.parameters[paramName],
                unit: this.inferUnit(paramName),
                editable: true
            }));

            // Add configuration name column
            table.columns.unshift({
                name: 'ConfigurationName',
                type: 'string',
                unit: null,
                editable: true
            });
        }

        this.designTables.set(table.id, table);

        return table;
    }

    /**
     * Add row to design table (new configuration)
     */
    addDesignTableRow(tableId, values = {}) {
        const table = this.designTables.get(tableId);
        if (!table) {
            throw new Error(`Design table ${tableId} not found`);
        }

        const row = {
            id: `row_${Date.now()}`,
            configName: values.ConfigurationName || `Config${table.rows.length + 1}`,
            parameters: {},
            suppressed: false
        };

        // Populate parameters from values
        for (const column of table.columns) {
            if (column.name !== 'ConfigurationName') {
                row.parameters[column.name] = values[column.name] !== undefined
                    ? values[column.name]
                    : this.getDefaultValue(column.type);
            }
        }

        table.rows.push(row);

        return row;
    }

    /**
     * Update design table cell
     */
    updateDesignTableCell(tableId, rowIndex, columnName, value) {
        const table = this.designTables.get(tableId);
        if (!table) {
            throw new Error(`Design table ${tableId} not found`);
        }

        if (rowIndex >= table.rows.length) {
            throw new Error(`Row ${rowIndex} not found`);
        }

        const row = table.rows[rowIndex];

        if (columnName === 'ConfigurationName') {
            row.configName = value;
        } else {
            row.parameters[columnName] = value;
        }

        return row;
    }

    /**
     * Switch active configuration
     */
    switchConfiguration(modelId, configId) {
        const configs = this.configurations.get(modelId);
        if (!configs || !configs.has(configId)) {
            throw new Error(`Configuration ${configId} not found for model ${modelId}`);
        }

        const config = configs.get(configId);

        return {
            success: true,
            activeConfig: config,
            parameters: config.parameters,
            message: `Switched to configuration: ${config.name}`
        };
    }

    /**
     * Get all configurations for a model
     */
    getConfigurations(modelId) {
        const configs = this.configurations.get(modelId);
        if (!configs) {
            return [];
        }

        return Array.from(configs.values());
    }

    /**
     * Import design table from CSV/Excel
     */
    async importDesignTable(tableId, fileData, format = 'csv') {
        const table = this.designTables.get(tableId);
        if (!table) {
            throw new Error(`Design table ${tableId} not found`);
        }

        let rows = [];

        if (format === 'csv') {
            rows = this.parseCSV(fileData);
        } else if (format === 'excel') {
            rows = this.parseExcel(fileData);
        }

        // Clear existing rows
        table.rows = [];

        // Import rows
        for (const rowData of rows) {
            this.addDesignTableRow(tableId, rowData);
        }

        table.linkedFile = fileData.filename;

        return {
            success: true,
            rowsImported: table.rows.length,
            table: table
        };
    }

    /**
     * Export design table to CSV
     */
    exportDesignTableCSV(tableId) {
        const table = this.designTables.get(tableId);
        if (!table) {
            throw new Error(`Design table ${tableId} not found`);
        }

        // Build CSV header
        const headers = table.columns.map(col => col.name);
        let csv = headers.join(',') + '\n';

        // Add rows
        for (const row of table.rows) {
            const values = [];
            for (const column of table.columns) {
                if (column.name === 'ConfigurationName') {
                    values.push(row.configName);
                } else {
                    values.push(row.parameters[column.name] || '');
                }
            }
            csv += values.join(',') + '\n';
        }

        return {
            filename: `${table.name}.csv`,
            content: csv,
            mimeType: 'text/csv'
        };
    }

    /**
     * Create product family from configurations
     */
    createProductFamily(modelId, familyName, configurations) {
        const family = {
            id: `family_${Date.now()}`,
            name: familyName,
            modelId: modelId,
            configurations: configurations,
            metadata: {
                createdAt: new Date().toISOString(),
                description: '',
                tags: []
            }
        };

        return family;
    }

    /**
     * Generate configuration matrix (show all parameter combinations)
     */
    generateConfigurationMatrix(parameters) {
        const matrix = {
            parameters: parameters,
            combinations: [],
            totalCount: 1
        };

        // Calculate total combinations
        for (const param of parameters) {
            matrix.totalCount *= param.values.length;
        }

        // Generate all combinations (simplified for now)
        matrix.combinations = this.generateCombinations(parameters);

        return matrix;
    }

    /**
     * Generate all combinations of parameter values
     */
    generateCombinations(parameters, index = 0, current = {}) {
        if (index >= parameters.length) {
            return [{ ...current }];
        }

        const param = parameters[index];
        let combinations = [];

        for (const value of param.values) {
            current[param.name] = value;
            combinations = combinations.concat(
                this.generateCombinations(parameters, index + 1, current)
            );
        }

        return combinations;
    }

    /**
     * Compare configurations
     */
    compareConfigurations(configId1, configId2) {
        const configs = Array.from(this.configurations.values())
            .flatMap(map => Array.from(map.values()));

        const config1 = configs.find(c => c.id === configId1);
        const config2 = configs.find(c => c.id === configId2);

        if (!config1 || !config2) {
            throw new Error('Configuration not found');
        }

        const differences = [];

        // Compare parameters
        const allParams = new Set([
            ...Object.keys(config1.parameters),
            ...Object.keys(config2.parameters)
        ]);

        for (const param of allParams) {
            const val1 = config1.parameters[param];
            const val2 = config2.parameters[param];

            if (val1 !== val2) {
                differences.push({
                    parameter: param,
                    config1Value: val1,
                    config2Value: val2,
                    delta: typeof val1 === 'number' && typeof val2 === 'number'
                        ? val2 - val1
                        : null
                });
            }
        }

        return {
            config1: config1.name,
            config2: config2.name,
            differences: differences,
            identical: differences.length === 0
        };
    }

    /**
     * Suppress/unsuppress configuration
     */
    toggleConfigurationSuppression(modelId, configId) {
        const configs = this.configurations.get(modelId);
        if (!configs || !configs.has(configId)) {
            throw new Error('Configuration not found');
        }

        const config = configs.get(configId);
        config.suppressed = !config.suppressed;

        return config;
    }

    /**
     * Helper: Infer unit from parameter name
     */
    inferUnit(paramName) {
        const lowerName = paramName.toLowerCase();

        if (lowerName.includes('length') || lowerName.includes('width') ||
            lowerName.includes('height') || lowerName.includes('depth')) {
            return 'mm';
        }
        if (lowerName.includes('angle') || lowerName.includes('rotation')) {
            return 'deg';
        }
        if (lowerName.includes('mass') || lowerName.includes('weight')) {
            return 'kg';
        }
        if (lowerName.includes('quantity') || lowerName.includes('count')) {
            return null; // dimensionless
        }

        return null;
    }

    /**
     * Helper: Get default value for type
     */
    getDefaultValue(type) {
        switch (type) {
            case 'number': return 0;
            case 'string': return '';
            case 'boolean': return false;
            default: return null;
        }
    }

    /**
     * Helper: Parse CSV data
     */
    parseCSV(fileData) {
        const lines = fileData.content.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            const values = lines[i].split(',').map(v => v.trim());
            const rowData = {};

            headers.forEach((header, index) => {
                rowData[header] = values[index];
            });

            rows.push(rowData);
        }

        return rows;
    }

    /**
     * Helper: Parse Excel data (simplified)
     */
    parseExcel(fileData) {
        // Simplified - would use actual Excel parsing library
        return this.parseCSV(fileData);
    }
}

module.exports = ConfigurationService;
