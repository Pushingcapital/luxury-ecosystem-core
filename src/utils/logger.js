const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += '\n' + JSON.stringify(meta, null, 2);
    }
    return msg;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: {
    service: 'luxury-automotive-ecosystem',
    environment: process.env.NODE_ENV || 'development',
    version: require('../../package.json').version
  },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760, // 10MB
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      format: logFormat
    }),
    
    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      format: logFormat
    }),
    
    // Separate file for revenue and business metrics
    new winston.transports.File({
      filename: path.join(logDir, 'revenue.log'),
      level: 'info',
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      format: logFormat,
      filter: info => info.category === 'revenue' || info.category === 'cascade'
    }),
    
    // Separate file for audit logs
    new winston.transports.File({
      filename: path.join(logDir, 'audit.log'),
      level: 'info',
      maxsize: parseInt(process.env.LOG_MAX_SIZE) || 10485760,
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
      format: logFormat,
      filter: info => info.category === 'audit'
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      format: logFormat
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      format: logFormat
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true
  }));
}

// Custom logging methods for business events
logger.revenue = (message, data = {}) => {
  logger.info(message, { ...data, category: 'revenue' });
};

logger.cascade = (message, data = {}) => {
  logger.info(message, { ...data, category: 'cascade' });
};

logger.audit = (message, data = {}) => {
  logger.info(message, { ...data, category: 'audit' });
};

logger.performance = (message, data = {}) => {
  logger.info(message, { ...data, category: 'performance' });
};

logger.integration = (message, data = {}) => {
  logger.info(message, { ...data, category: 'integration' });
};

logger.security = (message, data = {}) => {
  logger.warn(message, { ...data, category: 'security' });
};

// Performance monitoring wrapper
logger.time = (label) => {
  const start = Date.now();
  return {
    end: (message = '', data = {}) => {
      const duration = Date.now() - start;
      logger.performance(`${label} completed in ${duration}ms`, {
        ...data,
        duration,
        label
      });
      return duration;
    }
  };
};

// Database query logging
logger.query = (query, params = [], duration = 0) => {
  logger.debug('Database Query', {
    query: query.replace(/\s+/g, ' ').trim(),
    params: params.length > 0 ? params : undefined,
    duration: `${duration}ms`,
    category: 'database'
  });
};

// API request logging
logger.request = (req, res, duration) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    category: 'api'
  };
  
  if (res.statusCode >= 400) {
    logger.warn('API Request Failed', logData);
  } else {
    logger.info('API Request', logData);
  }
};

// Revenue tracking
logger.revenueGenerated = (clientId, serviceId, amount, orderId) => {
  logger.revenue('Revenue Generated', {
    clientId,
    serviceId,
    orderId,
    amount,
    timestamp: new Date().toISOString()
  });
};

// Service cascade tracking
logger.cascadeTriggered = (clientId, entryService, triggeredService, conversionRate) => {
  logger.cascade('Service Cascade Triggered', {
    clientId,
    entryService,
    triggeredService,
    conversionRate,
    timestamp: new Date().toISOString()
  });
};

// Integration event logging
logger.integrationEvent = (type, action, status, data = {}) => {
  logger.integration(`Integration Event: ${type} - ${action}`, {
    type,
    action,
    status,
    ...data,
    timestamp: new Date().toISOString()
  });
};

// Error enrichment
const originalError = logger.error;
logger.error = (message, error = {}) => {
  const enrichedError = {
    message,
    stack: error.stack,
    code: error.code,
    statusCode: error.statusCode,
    timestamp: new Date().toISOString(),
    ...error
  };
  
  originalError(enrichedError);
};

// Health check logging
logger.healthCheck = (component, status, details = {}) => {
  const logLevel = status === 'healthy' ? 'info' : 'error';
  logger[logLevel](`Health Check: ${component}`, {
    component,
    status,
    ...details,
    category: 'health'
  });
};

module.exports = logger; 