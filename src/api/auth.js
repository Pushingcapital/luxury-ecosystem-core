const express = require('express');
const Joi = require('joi');
const { asyncHandler, validate } = require('../middleware/errorHandler');
const { 
  login, 
  register, 
  refreshToken, 
  logout, 
  authenticate, 
  optionalAuth 
} = require('../middleware/auth');
const logger = require('../utils/logger');
const database = require('../database/connection');
const redis = require('../utils/redis');

const router = express.Router();

// Validation schemas
const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required()
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]')).required()
    .messages({
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
    }),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  phone: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).optional(),
  businessName: Joi.string().max(255).optional(),
  clientType: Joi.string().valid('individual', 'business', 'dealer').default('individual'),
  vehicleValue: Joi.number().positive().optional(),
  annualIncome: Joi.number().positive().optional(),
  referralSource: Joi.string().max(100).optional()
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required()
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]')).required()
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', 
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    
    try {
      const result = await login(email, password, req);
      
      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      
      res.json({
        success: true,
        message: 'Login successful',
        user: result.user,
        accessToken: result.accessToken
      });
      
    } catch (error) {
      logger.security('Login failed', {
        email,
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: User registration
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *               businessName:
 *                 type: string
 *               clientType:
 *                 type: string
 *                 enum: [individual, business, dealer]
 *               vehicleValue:
 *                 type: number
 *               annualIncome:
 *                 type: number
 *               referralSource:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registration successful
 *       400:
 *         description: Validation error
 *       409:
 *         description: User already exists
 */
router.post('/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const userData = req.body;
    
    try {
      const user = await register(userData);
      
      // Create client profile with additional data
      const clientData = {
        business_name: userData.businessName,
        client_type: userData.clientType,
        vehicle_value: userData.vehicleValue,
        annual_income: userData.annualIncome,
        referral_source: userData.referralSource,
        journey_stage: 'discovery'
      };
      
      await database.update('clients', user.id, clientData);
      
      res.status(201).json({
        success: true,
        message: 'Registration successful',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        }
      });
      
    } catch (error) {
      logger.error('Registration failed', {
        email: userData.email,
        error: error.message,
        ip: req.ip
      });
      
      if (error.message === 'User already exists') {
        return res.status(409).json({
          success: false,
          error: 'User already exists',
          code: 'USER_EXISTS'
        });
      }
      
      res.status(400).json({
        success: false,
        error: 'Registration failed',
        code: 'REGISTRATION_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid refresh token
 */
router.post('/refresh',
  validate(refreshTokenSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken: tokenFromBody } = req.body;
    const tokenFromCookie = req.cookies?.refreshToken;
    
    const refreshTokenToUse = tokenFromBody || tokenFromCookie;
    
    if (!refreshTokenToUse) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token required',
        code: 'REFRESH_TOKEN_REQUIRED'
      });
    }
    
    try {
      const result = await refreshToken(refreshTokenToUse);
      
      // Set new refresh token as httpOnly cookie
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      
      res.json({
        success: true,
        message: 'Token refreshed successfully',
        accessToken: result.accessToken
      });
      
    } catch (error) {
      logger.security('Token refresh failed', {
        error: error.message,
        ip: req.ip
      });
      
      res.status(401).json({
        success: false,
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: User logout
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      await logout(req);
      
      // Clear refresh token cookie
      res.clearCookie('refreshToken');
      
      res.json({
        success: true,
        message: 'Logout successful'
      });
      
    } catch (error) {
      logger.error('Logout failed', {
        userId: req.user?.id,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Logout failed',
        code: 'LOGOUT_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 */
router.get('/me',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      // Get user with client profile
      const userProfile = await database.query(`
        SELECT 
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          u.phone,
          u.role,
          u.is_verified,
          u.created_at,
          u.last_login,
          c.business_name,
          c.client_type,
          c.status,
          c.vehicle_value,
          c.credit_score,
          c.annual_income,
          c.journey_stage,
          c.lifetime_value,
          c.total_spent,
          c.services_count,
          c.referral_source,
          c.hubspot_contact_id
        FROM users u
        LEFT JOIN clients c ON u.id = c.user_id
        WHERE u.id = $1
      `, [req.user.id]);
      
      if (userProfile.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }
      
      const profile = userProfile.rows[0];
      
      // Get recent service orders
      const recentOrders = await database.query(`
        SELECT 
          so.id,
          so.order_number,
          so.status,
          so.final_price,
          so.created_at,
          so.completed_at,
          s.name as service_name,
          s.slug as service_slug
        FROM service_orders so
        JOIN services s ON so.service_id = s.id
        WHERE so.client_id = $1
        ORDER BY so.created_at DESC
        LIMIT 5
      `, [profile.id]);
      
      res.json({
        success: true,
        user: {
          id: profile.id,
          email: profile.email,
          firstName: profile.first_name,
          lastName: profile.last_name,
          phone: profile.phone,
          role: profile.role,
          isVerified: profile.is_verified,
          createdAt: profile.created_at,
          lastLogin: profile.last_login,
          client: {
            businessName: profile.business_name,
            clientType: profile.client_type,
            status: profile.status,
            vehicleValue: profile.vehicle_value,
            creditScore: profile.credit_score,
            annualIncome: profile.annual_income,
            journeyStage: profile.journey_stage,
            lifetimeValue: profile.lifetime_value,
            totalSpent: profile.total_spent,
            servicesCount: profile.services_count,
            referralSource: profile.referral_source,
            hubspotContactId: profile.hubspot_contact_id
          },
          recentOrders: recentOrders.rows
        }
      });
      
    } catch (error) {
      logger.error('Error getting user profile', {
        userId: req.user.id,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get user profile',
        code: 'PROFILE_ERROR'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Password reset email sent
 */
router.post('/forgot-password',
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    
    try {
      const user = await database.findOne('users', { email: email.toLowerCase() });
      
      if (!user) {
        // Don't reveal if user exists or not
        return res.json({
          success: true,
          message: 'If the email exists, a password reset link has been sent'
        });
      }
      
      // Generate reset token
      const resetToken = require('crypto').randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 3600000); // 1 hour
      
      await database.update('users', user.id, {
        password_reset_token: resetToken,
        password_reset_expires: resetExpires
      });
      
      // TODO: Send email with reset link
      // await emailService.sendPasswordReset(user.email, resetToken);
      
      logger.audit('Password reset requested', {
        userId: user.id,
        email: user.email,
        ip: req.ip
      });
      
      res.json({
        success: true,
        message: 'Password reset email sent'
      });
      
    } catch (error) {
      logger.error('Password reset request failed', {
        email,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to process password reset request',
        code: 'RESET_REQUEST_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    
    try {
      const user = await database.findOne('users', { 
        password_reset_token: token 
      });
      
      if (!user || new Date() > new Date(user.password_reset_expires)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired reset token',
          code: 'INVALID_RESET_TOKEN'
        });
      }
      
      // Hash new password
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(password, 12);
      
      await database.update('users', user.id, {
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_expires: null
      });
      
      // Invalidate all existing sessions
      await redis.del(`refresh:${user.id}`);
      
      logger.audit('Password reset completed', {
        userId: user.id,
        email: user.email,
        ip: req.ip
      });
      
      res.json({
        success: true,
        message: 'Password reset successful'
      });
      
    } catch (error) {
      logger.error('Password reset failed', {
        error: error.message,
        ip: req.ip
      });
      
      res.status(500).json({
        success: false,
        error: 'Password reset failed',
        code: 'RESET_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify email address
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid verification token
 */
router.post('/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Verification token required',
        code: 'TOKEN_REQUIRED'
      });
    }
    
    try {
      const user = await database.findOne('users', { 
        verification_token: token 
      });
      
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'Invalid verification token',
          code: 'INVALID_TOKEN'
        });
      }
      
      await database.update('users', user.id, {
        is_verified: true,
        verification_token: null
      });
      
      logger.audit('Email verified', {
        userId: user.id,
        email: user.email,
        ip: req.ip
      });
      
      res.json({
        success: true,
        message: 'Email verified successfully'
      });
      
    } catch (error) {
      logger.error('Email verification failed', {
        error: error.message,
        ip: req.ip
      });
      
      res.status(500).json({
        success: false,
        error: 'Email verification failed',
        code: 'VERIFICATION_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     summary: Resend email verification
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification email sent
 */
router.post('/resend-verification',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      const user = await database.findById('users', req.user.id);
      
      if (user.is_verified) {
        return res.status(400).json({
          success: false,
          error: 'Email already verified',
          code: 'ALREADY_VERIFIED'
        });
      }
      
      // Generate new verification token
      const verificationToken = require('crypto').randomBytes(32).toString('hex');
      
      await database.update('users', user.id, {
        verification_token: verificationToken
      });
      
      // TODO: Send verification email
      // await emailService.sendVerificationEmail(user.email, verificationToken);
      
      logger.audit('Verification email resent', {
        userId: user.id,
        email: user.email,
        ip: req.ip
      });
      
      res.json({
        success: true,
        message: 'Verification email sent'
      });
      
    } catch (error) {
      logger.error('Resend verification failed', {
        userId: req.user.id,
        error: error.message
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to resend verification email',
        code: 'RESEND_FAILED'
      });
    }
  })
);

// Health check endpoint
router.get('/health',
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      service: 'Authentication API',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  })
);

module.exports = router; 