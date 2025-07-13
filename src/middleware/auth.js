const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const database = require('../database/connection');
const redis = require('../utils/redis');
const logger = require('../utils/logger');

class AuthMiddleware {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
    this.refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  // Generate JWT token
  generateToken(payload, expiresIn = this.jwtExpiresIn) {
    return jwt.sign(payload, this.jwtSecret, { expiresIn });
  }

  // Generate refresh token
  generateRefreshToken(payload) {
    return jwt.sign(payload, this.jwtSecret, { expiresIn: this.refreshExpiresIn });
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  // Hash password
  async hashPassword(password) {
    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    return await bcrypt.hash(password, rounds);
  }

  // Verify password
  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  // Main authentication middleware
  async authenticate(req, res, next) {
    try {
      const token = this.extractToken(req);
      
      if (!token) {
        return res.status(401).json({
          error: 'Access token required',
          code: 'TOKEN_REQUIRED'
        });
      }

      // Verify token
      const decoded = this.verifyToken(token);
      
      // Check if token is blacklisted
      const isBlacklisted = await redis.exists(`blacklist:${token}`);
      if (isBlacklisted) {
        return res.status(401).json({
          error: 'Token has been revoked',
          code: 'TOKEN_REVOKED'
        });
      }

      // Get user from database
      const user = await database.findById('users', decoded.userId);
      if (!user || !user.is_active) {
        return res.status(401).json({
          error: 'User not found or inactive',
          code: 'USER_INACTIVE'
        });
      }

      // Update last login
      await database.update('users', user.id, {
        last_login: new Date()
      });

      // Attach user to request
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        isVerified: user.is_verified
      };

      // Log authentication
      logger.audit('User authenticated', {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      next();
    } catch (error) {
      logger.security('Authentication failed', {
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.originalUrl
      });

      return res.status(401).json({
        error: 'Authentication failed',
        code: 'AUTH_FAILED'
      });
    }
  }

  // Extract token from request
  extractToken(req) {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    // Check for token in cookies
    if (req.cookies && req.cookies.token) {
      return req.cookies.token;
    }
    
    return null;
  }

  // Role-based authorization
  authorize(allowedRoles = []) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
        logger.security('Authorization failed', {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: allowedRoles,
          ip: req.ip,
          url: req.originalUrl
        });

        return res.status(403).json({
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      next();
    };
  }

  // Check if user owns resource or has admin role
  async authorizeResource(req, res, next) {
    try {
      const { clientId } = req.params;
      const user = req.user;

      // Admin and super_admin can access all resources
      if (['admin', 'super_admin'].includes(user.role)) {
        return next();
      }

      // Check if user owns the client resource
      const client = await database.findById('clients', clientId);
      if (!client) {
        return res.status(404).json({
          error: 'Client not found',
          code: 'CLIENT_NOT_FOUND'
        });
      }

      if (client.user_id !== user.id) {
        logger.security('Resource access denied', {
          userId: user.id,
          clientId,
          ip: req.ip,
          url: req.originalUrl
        });

        return res.status(403).json({
          error: 'Access denied to this resource',
          code: 'RESOURCE_ACCESS_DENIED'
        });
      }

      next();
    } catch (error) {
      logger.error('Authorization error:', error);
      return res.status(500).json({
        error: 'Authorization check failed',
        code: 'AUTH_CHECK_FAILED'
      });
    }
  }

  // Verify email required middleware
  requireEmailVerification(req, res, next) {
    if (!req.user.isVerified) {
      return res.status(403).json({
        error: 'Email verification required',
        code: 'EMAIL_VERIFICATION_REQUIRED'
      });
    }
    next();
  }

  // Rate limiting by user
  async rateLimitByUser(req, res, next) {
    try {
      const userId = req.user?.id || req.ip;
      const key = `rate_limit:${userId}`;
      const limit = 100; // requests per window
      const windowSeconds = 900; // 15 minutes

      const result = await redis.rateLimit(key, limit, windowSeconds);
      
      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
      });

      if (!result.allowed) {
        logger.security('Rate limit exceeded', {
          userId,
          ip: req.ip,
          url: req.originalUrl,
          count: result.count
        });

        return res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }

      next();
    } catch (error) {
      logger.error('Rate limiting error:', error);
      next(); // Continue on error
    }
  }

  // Login method
  async login(email, password, req) {
    try {
      // Find user by email
      const user = await database.findOne('users', { email: email.toLowerCase() });
      
      if (!user) {
        logger.security('Login attempt with invalid email', {
          email,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        throw new Error('Invalid credentials');
      }

      // Verify password
      const isValidPassword = await this.verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        logger.security('Login attempt with invalid password', {
          userId: user.id,
          email,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
        throw new Error('Invalid credentials');
      }

      // Check if user is active
      if (!user.is_active) {
        throw new Error('Account is inactive');
      }

      // Generate tokens
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role
      };

      const accessToken = this.generateToken(tokenPayload);
      const refreshToken = this.generateRefreshToken(tokenPayload);

      // Store refresh token in Redis
      await redis.set(`refresh:${user.id}`, refreshToken, 7 * 24 * 60 * 60); // 7 days

      // Update last login
      await database.update('users', user.id, {
        last_login: new Date()
      });

      logger.audit('User login successful', {
        userId: user.id,
        email: user.email,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name,
          isVerified: user.is_verified
        },
        accessToken,
        refreshToken
      };
    } catch (error) {
      logger.error('Login error:', error);
      throw error;
    }
  }

  // Refresh token method
  async refreshToken(refreshToken) {
    try {
      const decoded = this.verifyToken(refreshToken);
      
      // Check if refresh token exists in Redis
      const storedToken = await redis.get(`refresh:${decoded.userId}`);
      if (storedToken !== refreshToken) {
        throw new Error('Invalid refresh token');
      }

      // Get user
      const user = await database.findById('users', decoded.userId);
      if (!user || !user.is_active) {
        throw new Error('User not found or inactive');
      }

      // Generate new tokens
      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role
      };

      const newAccessToken = this.generateToken(tokenPayload);
      const newRefreshToken = this.generateRefreshToken(tokenPayload);

      // Update refresh token in Redis
      await redis.set(`refresh:${user.id}`, newRefreshToken, 7 * 24 * 60 * 60);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      logger.error('Token refresh error:', error);
      throw error;
    }
  }

  // Logout method
  async logout(req) {
    try {
      const token = this.extractToken(req);
      const user = req.user;

      if (token) {
        // Add token to blacklist
        const decoded = this.verifyToken(token);
        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
        await redis.set(`blacklist:${token}`, true, expiresIn);
      }

      // Remove refresh token
      if (user) {
        await redis.del(`refresh:${user.id}`);
        
        logger.audit('User logout', {
          userId: user.id,
          email: user.email,
          ip: req.ip
        });
      }

      return { success: true };
    } catch (error) {
      logger.error('Logout error:', error);
      throw error;
    }
  }

  // Register method
  async register(userData) {
    try {
      const { email, password, firstName, lastName, phone } = userData;

      // Check if user already exists
      const existingUser = await database.findOne('users', { email: email.toLowerCase() });
      if (existingUser) {
        throw new Error('User already exists');
      }

      // Hash password
      const passwordHash = await this.hashPassword(password);

      // Create user
      const user = await database.create('users', {
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        phone,
        role: 'client',
        is_active: true,
        is_verified: false
      });

      // Create client profile
      await database.create('clients', {
        user_id: user.id,
        journey_stage: 'discovery'
      });

      logger.audit('User registered', {
        userId: user.id,
        email: user.email
      });

      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      };
    } catch (error) {
      logger.error('Registration error:', error);
      throw error;
    }
  }

  // Optional authentication (for public endpoints that can benefit from user context)
  async optionalAuth(req, res, next) {
    try {
      const token = this.extractToken(req);
      
      if (token) {
        const decoded = this.verifyToken(token);
        const user = await database.findById('users', decoded.userId);
        
        if (user && user.is_active) {
          req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            firstName: user.first_name,
            lastName: user.last_name,
            isVerified: user.is_verified
          };
        }
      }
    } catch (error) {
      // Silently fail for optional auth
      logger.debug('Optional auth failed:', error.message);
    }
    
    next();
  }
}

// Create singleton instance
const authMiddleware = new AuthMiddleware();

// Export middleware functions
module.exports = {
  authenticate: authMiddleware.authenticate.bind(authMiddleware),
  authorize: authMiddleware.authorize.bind(authMiddleware),
  authorizeResource: authMiddleware.authorizeResource.bind(authMiddleware),
  requireEmailVerification: authMiddleware.requireEmailVerification.bind(authMiddleware),
  rateLimitByUser: authMiddleware.rateLimitByUser.bind(authMiddleware),
  optionalAuth: authMiddleware.optionalAuth.bind(authMiddleware),
  login: authMiddleware.login.bind(authMiddleware),
  register: authMiddleware.register.bind(authMiddleware),
  refreshToken: authMiddleware.refreshToken.bind(authMiddleware),
  logout: authMiddleware.logout.bind(authMiddleware),
  hashPassword: authMiddleware.hashPassword.bind(authMiddleware),
  verifyPassword: authMiddleware.verifyPassword.bind(authMiddleware)
}; 