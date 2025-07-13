const redis = require('redis');
const logger = require('./logger');

class RedisConnection {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.connectionOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      family: 4,
      keyPrefix: 'luxury_auto:',
      db: 0
    };
  }

  async connect() {
    try {
      this.client = redis.createClient(this.connectionOptions);
      
      // Event handlers
      this.client.on('connect', () => {
        logger.info('Redis connection established');
        this.isConnected = true;
      });
      
      this.client.on('ready', () => {
        logger.info('Redis client ready');
      });
      
      this.client.on('error', (error) => {
        logger.error('Redis connection error:', error);
        this.isConnected = false;
      });
      
      this.client.on('end', () => {
        logger.info('Redis connection ended');
        this.isConnected = false;
      });
      
      this.client.on('reconnecting', () => {
        logger.info('Redis reconnecting...');
      });
      
      await this.client.connect();
      
      // Test connection
      await this.client.ping();
      logger.info('Redis connection successful');
      
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis connection closed');
    }
  }

  async ping() {
    if (!this.isConnected) {
      throw new Error('Redis not connected');
    }
    return await this.client.ping();
  }

  // Basic operations
  async get(key) {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  async set(key, value, ttl = 3600) {
    try {
      const serialized = JSON.stringify(value);
      if (ttl > 0) {
        await this.client.setEx(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  }

  async del(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      return false;
    }
  }

  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  async expire(key, ttl) {
    try {
      return await this.client.expire(key, ttl);
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  // Hash operations
  async hget(key, field) {
    try {
      const value = await this.client.hGet(key, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      return null;
    }
  }

  async hset(key, field, value) {
    try {
      const serialized = JSON.stringify(value);
      return await this.client.hSet(key, field, serialized);
    } catch (error) {
      logger.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      return false;
    }
  }

  async hgetall(key) {
    try {
      const hash = await this.client.hGetAll(key);
      const result = {};
      for (const [field, value] of Object.entries(hash)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value;
        }
      }
      return result;
    } catch (error) {
      logger.error(`Redis HGETALL error for key ${key}:`, error);
      return {};
    }
  }

  // List operations
  async lpush(key, ...values) {
    try {
      const serialized = values.map(v => JSON.stringify(v));
      return await this.client.lPush(key, serialized);
    } catch (error) {
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      return false;
    }
  }

  async rpush(key, ...values) {
    try {
      const serialized = values.map(v => JSON.stringify(v));
      return await this.client.rPush(key, serialized);
    } catch (error) {
      logger.error(`Redis RPUSH error for key ${key}:`, error);
      return false;
    }
  }

  async lpop(key) {
    try {
      const value = await this.client.lPop(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Redis LPOP error for key ${key}:`, error);
      return null;
    }
  }

  async lrange(key, start, stop) {
    try {
      const values = await this.client.lRange(key, start, stop);
      return values.map(v => {
        try {
          return JSON.parse(v);
        } catch {
          return v;
        }
      });
    } catch (error) {
      logger.error(`Redis LRANGE error for key ${key}:`, error);
      return [];
    }
  }

  // Set operations
  async sadd(key, ...members) {
    try {
      const serialized = members.map(m => JSON.stringify(m));
      return await this.client.sAdd(key, serialized);
    } catch (error) {
      logger.error(`Redis SADD error for key ${key}:`, error);
      return false;
    }
  }

  async smembers(key) {
    try {
      const members = await this.client.sMembers(key);
      return members.map(m => {
        try {
          return JSON.parse(m);
        } catch {
          return m;
        }
      });
    } catch (error) {
      logger.error(`Redis SMEMBERS error for key ${key}:`, error);
      return [];
    }
  }

  // Caching helpers
  async cache(key, fetchFunction, ttl = 3600) {
    try {
      // Try to get from cache first
      let cached = await this.get(key);
      if (cached !== null) {
        logger.debug(`Cache hit for key: ${key}`);
        return cached;
      }
      
      // If not in cache, fetch data
      logger.debug(`Cache miss for key: ${key}`);
      const data = await fetchFunction();
      
      // Store in cache
      await this.set(key, data, ttl);
      return data;
      
    } catch (error) {
      logger.error(`Cache error for key ${key}:`, error);
      // If caching fails, still return the data
      return await fetchFunction();
    }
  }

  // Session management
  async createSession(userId, sessionData, ttl = 86400) {
    const sessionId = `session:${userId}:${Date.now()}`;
    await this.set(sessionId, {
      userId,
      ...sessionData,
      createdAt: new Date().toISOString()
    }, ttl);
    return sessionId;
  }

  async getSession(sessionId) {
    return await this.get(sessionId);
  }

  async updateSession(sessionId, updates) {
    const session = await this.get(sessionId);
    if (session) {
      const updatedSession = { ...session, ...updates };
      await this.set(sessionId, updatedSession);
      return updatedSession;
    }
    return null;
  }

  async destroySession(sessionId) {
    return await this.del(sessionId);
  }

  // Rate limiting
  async rateLimit(key, limit, windowSeconds) {
    try {
      const multi = this.client.multi();
      multi.incr(key);
      multi.expire(key, windowSeconds);
      
      const results = await multi.exec();
      const count = results[0];
      
      return {
        allowed: count <= limit,
        count,
        remaining: Math.max(0, limit - count),
        resetTime: Date.now() + (windowSeconds * 1000)
      };
    } catch (error) {
      logger.error(`Rate limit error for key ${key}:`, error);
      return { allowed: true, count: 0, remaining: limit, resetTime: Date.now() };
    }
  }

  // Revenue tracking cache
  async cacheRevenueData(clientId, data, ttl = 3600) {
    const key = `revenue:${clientId}`;
    return await this.set(key, data, ttl);
  }

  async getRevenueData(clientId) {
    const key = `revenue:${clientId}`;
    return await this.get(key);
  }

  // Service cascade cache
  async cacheCascadeRules(serviceId, rules, ttl = 7200) {
    const key = `cascade:${serviceId}`;
    return await this.set(key, rules, ttl);
  }

  async getCascadeRules(serviceId) {
    const key = `cascade:${serviceId}`;
    return await this.get(key);
  }

  // Client journey cache
  async cacheClientJourney(clientId, journey, ttl = 1800) {
    const key = `journey:${clientId}`;
    return await this.set(key, journey, ttl);
  }

  async getClientJourney(clientId) {
    const key = `journey:${clientId}`;
    return await this.get(key);
  }

  // Vehicle data cache
  async cacheVehicleData(vin, data, ttl = 86400) {
    const key = `vehicle:${vin}`;
    return await this.set(key, data, ttl);
  }

  async getVehicleData(vin) {
    const key = `vehicle:${vin}`;
    return await this.get(key);
  }

  // Notification queue
  async queueNotification(userId, notification) {
    const key = `notifications:${userId}`;
    return await this.rpush(key, notification);
  }

  async getNotifications(userId, limit = 50) {
    const key = `notifications:${userId}`;
    return await this.lrange(key, 0, limit - 1);
  }

  // Performance metrics
  async recordMetric(metric, value, timestamp = Date.now()) {
    const key = `metrics:${metric}`;
    const data = { value, timestamp };
    return await this.rpush(key, data);
  }

  async getMetrics(metric, limit = 100) {
    const key = `metrics:${metric}`;
    return await this.lrange(key, -limit, -1);
  }

  // Bulk operations
  async mget(keys) {
    try {
      const values = await this.client.mGet(keys);
      return values.map(v => v ? JSON.parse(v) : null);
    } catch (error) {
      logger.error('Redis MGET error:', error);
      return keys.map(() => null);
    }
  }

  async mset(keyValuePairs) {
    try {
      const serialized = [];
      for (let i = 0; i < keyValuePairs.length; i += 2) {
        serialized.push(keyValuePairs[i]);
        serialized.push(JSON.stringify(keyValuePairs[i + 1]));
      }
      return await this.client.mSet(serialized);
    } catch (error) {
      logger.error('Redis MSET error:', error);
      return false;
    }
  }

  // Clear cache patterns
  async clearPattern(pattern) {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        return await this.client.del(keys);
      }
      return 0;
    } catch (error) {
      logger.error(`Redis clear pattern error for ${pattern}:`, error);
      return 0;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const start = Date.now();
      await this.ping();
      const latency = Date.now() - start;
      
      return {
        status: 'healthy',
        latency,
        connected: this.isConnected,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        connected: false,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const redisConnection = new RedisConnection();

module.exports = redisConnection; 