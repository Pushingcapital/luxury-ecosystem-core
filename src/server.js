const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Import utilities and middleware
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const auth = require('./middleware/auth');
const database = require('./database/connection');
const redis = require('./utils/redis');

// Import route modules
const authRoutes = require('./api/auth');
const clientRoutes = require('./api/clients');
const servicesRoutes = require('./api/services');
const revenueRoutes = require('./api/revenue');
const cascadeRoutes = require('./api/cascade');
const integrationsRoutes = require('./api/integrations');
const aiRoutes = require('./api/ai');
const dashboardRoutes = require('./api/dashboard');

// Import service modules
const CascadeEngine = require('./cascade/engine');
const RevenueOptimizer = require('./revenue/optimizer');
const IntegrationManager = require('./integrations/manager');

// Initialize Express app
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Global middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"]
    }
  }
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true
}));

app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: Math.ceil((process.env.RATE_LIMIT_WINDOW || 15) * 60)
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await database.query('SELECT 1');
    
    // Check Redis connection
    await redis.ping();
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Documentation
if (process.env.NODE_ENV !== 'production') {
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./utils/swagger');
  
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Luxury Automotive Ecosystem API'
  }));
}

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/clients', auth, clientRoutes);
app.use('/api/services', auth, servicesRoutes);
app.use('/api/revenue', auth, revenueRoutes);
app.use('/api/cascade', auth, cascadeRoutes);
app.use('/api/integrations', auth, integrationsRoutes);
app.use('/api/ai', auth, aiRoutes);
app.use('/api/dashboard', auth, dashboardRoutes);

// WebSocket connection handling
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token) {
    // Verify JWT token for WebSocket connections
    const jwt = require('jsonwebtoken');
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.role = decoded.role;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  } else {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}, User: ${socket.userId}`);
  
  // Join user to their personal room
  socket.join(`user_${socket.userId}`);
  
  // Join admin users to admin room
  if (socket.role === 'admin' || socket.role === 'super_admin') {
    socket.join('admin_room');
  }
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Make io available globally
app.set('io', io);

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString()
  });
});

// Initialize core services
async function initializeServices() {
  try {
    logger.info('Initializing core services...');
    
    // Initialize database connection
    await database.initialize();
    logger.info('Database connected successfully');
    
    // Initialize Redis connection
    await redis.connect();
    logger.info('Redis connected successfully');
    
    // Initialize cascade engine
    const cascadeEngine = new CascadeEngine();
    await cascadeEngine.initialize();
    app.set('cascadeEngine', cascadeEngine);
    logger.info('Cascade engine initialized');
    
    // Initialize revenue optimizer
    const revenueOptimizer = new RevenueOptimizer();
    await revenueOptimizer.initialize();
    app.set('revenueOptimizer', revenueOptimizer);
    logger.info('Revenue optimizer initialized');
    
    // Initialize integration manager
    const integrationManager = new IntegrationManager();
    await integrationManager.initialize();
    app.set('integrationManager', integrationManager);
    logger.info('Integration manager initialized');
    
    logger.info('All core services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Close database connections
    database.close();
    
    // Close Redis connection
    redis.disconnect();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

async function startServer() {
  try {
    await initializeServices();
    
    server.listen(PORT, HOST, () => {
      logger.info(`🚀 Luxury Automotive Ecosystem Server running on http://${HOST}:${PORT}`);
      logger.info(`📊 API Documentation available at http://${HOST}:${PORT}/api-docs`);
      logger.info(`🔧 Environment: ${process.env.NODE_ENV}`);
      logger.info(`💰 Revenue Optimization: ${process.env.REVENUE_OPTIMIZATION_ENABLED === 'true' ? 'Enabled' : 'Disabled'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app; 