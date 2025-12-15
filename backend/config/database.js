/**
 * PostgreSQL Database Configuration
 * Setup for project data, user sessions, design history
 * Note: Requires PostgreSQL to be installed and running
 */

const { Pool } = require('pg');

class DatabaseConfig {
    constructor() {
        this.pool = null;
        this.isConfigured = false;

        // Database connection settings
        this.config = {
            host: process.env.POSTGRES_HOST || 'localhost',
            port: process.env.POSTGRES_PORT || 5432,
            database: process.env.POSTGRES_DB || 'archdisc',
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || '',
            max: 20, // Maximum pool size
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        };
    }

    async initialize() {
        try {
            this.pool = new Pool(this.config);

            // Test connection
            const client = await this.pool.connect();
            console.log('✅ PostgreSQL connected successfully');
            client.release();

            this.isConfigured = true;
            await this.createTables();
        } catch (error) {
            console.warn('⚠️  PostgreSQL not configured:', error.message);
            console.warn('   Running without database persistence');
            this.isConfigured = false;
        }
    }

    async createTables() {
        if (!this.isConfigured) return;

        const createTablesSQL = `
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Projects table
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Design history table
      CREATE TABLE IF NOT EXISTS design_history (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        prompt TEXT NOT NULL,
        specifications JSONB,
        taxonomy_data JSONB,
        model_url VARCHAR(512),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- User preferences table
      CREATE TABLE IF NOT EXISTS user_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) UNIQUE,
        preferred_styles JSONB,
        preferred_materials JSONB,
        settings JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

        try {
            await this.pool.query(createTablesSQL);
            console.log('✅ Database tables created/verified');
        } catch (error) {
            console.error('❌ Error creating tables:', error.message);
        }
    }

    getPool() {
        return this.pool;
    }

    isReady() {
        return this.isConfigured;
    }
}

module.exports = new DatabaseConfig();
