const { Pool } = require('pg');
const logger = require('../utils/logger');

class DatabaseConnection {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  async initialize() {
    try {
      this.pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'luxury_automotive_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        max: parseInt(process.env.DB_MAX_CONNECTIONS) || 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });

      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isConnected = true;
      logger.info('Database connection established successfully');

      // Set up event listeners
      this.pool.on('error', (err) => {
        logger.error('Unexpected error on idle client', err);
        this.isConnected = false;
      });

      this.pool.on('connect', () => {
        logger.debug('New database client connected');
      });

      this.pool.on('remove', () => {
        logger.debug('Database client removed');
      });

    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async query(text, params = []) {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      if (duration > 1000) {
        logger.warn(`Slow query detected (${duration}ms):`, { query: text, params });
      }
      
      return result;
    } catch (error) {
      logger.error('Database query error:', { error: error.message, query: text, params });
      throw error;
    }
  }

  async transaction(callback) {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getClient() {
    if (!this.isConnected) {
      throw new Error('Database not connected');
    }
    return await this.pool.connect();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }

  // Helper methods for common operations
  async findById(table, id, columns = '*') {
    const query = `SELECT ${columns} FROM ${table} WHERE id = $1`;
    const result = await this.query(query, [id]);
    return result.rows[0] || null;
  }

  async findOne(table, conditions, columns = '*') {
    const whereClause = Object.keys(conditions)
      .map((key, index) => `${key} = $${index + 1}`)
      .join(' AND ');
    
    const query = `SELECT ${columns} FROM ${table} WHERE ${whereClause}`;
    const values = Object.values(conditions);
    
    const result = await this.query(query, values);
    return result.rows[0] || null;
  }

  async findMany(table, conditions = {}, options = {}) {
    const { limit, offset, orderBy, columns = '*' } = options;
    
    let query = `SELECT ${columns} FROM ${table}`;
    let values = [];
    
    if (Object.keys(conditions).length > 0) {
      const whereClause = Object.keys(conditions)
        .map((key, index) => `${key} = $${index + 1}`)
        .join(' AND ');
      query += ` WHERE ${whereClause}`;
      values = Object.values(conditions);
    }
    
    if (orderBy) {
      query += ` ORDER BY ${orderBy}`;
    }
    
    if (limit) {
      query += ` LIMIT $${values.length + 1}`;
      values.push(limit);
    }
    
    if (offset) {
      query += ` OFFSET $${values.length + 1}`;
      values.push(offset);
    }
    
    const result = await this.query(query, values);
    return result.rows;
  }

  async create(table, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    
    const query = `
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `;
    
    const result = await this.query(query, values);
    return result.rows[0];
  }

  async update(table, id, data) {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((col, index) => `${col} = $${index + 1}`).join(', ');
    
    const query = `
      UPDATE ${table}
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${values.length + 1}
      RETURNING *
    `;
    
    const result = await this.query(query, [...values, id]);
    return result.rows[0];
  }

  async delete(table, id) {
    const query = `DELETE FROM ${table} WHERE id = $1 RETURNING *`;
    const result = await this.query(query, [id]);
    return result.rows[0];
  }

  async exists(table, conditions) {
    const whereClause = Object.keys(conditions)
      .map((key, index) => `${key} = $${index + 1}`)
      .join(' AND ');
    
    const query = `SELECT EXISTS(SELECT 1 FROM ${table} WHERE ${whereClause})`;
    const values = Object.values(conditions);
    
    const result = await this.query(query, values);
    return result.rows[0].exists;
  }

  async count(table, conditions = {}) {
    let query = `SELECT COUNT(*) FROM ${table}`;
    let values = [];
    
    if (Object.keys(conditions).length > 0) {
      const whereClause = Object.keys(conditions)
        .map((key, index) => `${key} = $${index + 1}`)
        .join(' AND ');
      query += ` WHERE ${whereClause}`;
      values = Object.values(conditions);
    }
    
    const result = await this.query(query, values);
    return parseInt(result.rows[0].count);
  }

  // Health check method
  async ping() {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database ping failed:', error);
      return false;
    }
  }
}

// Create singleton instance
const database = new DatabaseConnection();

module.exports = database; 