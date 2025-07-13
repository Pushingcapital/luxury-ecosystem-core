const logger = require('../utils/logger');

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTH_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', retryAfter = 60) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

// Error handler middleware
const errorHandler = (error, req, res, next) => {
  let err = { ...error };
  err.message = error.message;

  // Log error details
  const errorDetails = {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  };

  // Database errors
  if (error.code === '23505') {
    err = new ConflictError('Resource already exists');
  } else if (error.code === '23503') {
    err = new ValidationError('Referenced resource does not exist');
  } else if (error.code === '23502') {
    err = new ValidationError('Required field is missing');
  } else if (error.code === '22001') {
    err = new ValidationError('Data too long for field');
  } else if (error.code === '08003') {
    err = new ServiceUnavailableError('Database connection not available');
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    err = new AuthenticationError('Invalid token');
  } else if (error.name === 'TokenExpiredError') {
    err = new AuthenticationError('Token has expired');
  }

  // Validation errors
  if (error.name === 'ValidationError') {
    const details = {};
    Object.keys(error.errors).forEach(key => {
      details[key] = error.errors[key].message;
    });
    err = new ValidationError('Validation failed', details);
  }

  // Mongoose cast errors
  if (error.name === 'CastError') {
    err = new ValidationError('Invalid ID format');
  }

  // Multer errors (file upload)
  if (error.code === 'LIMIT_FILE_SIZE') {
    err = new ValidationError('File too large');
  } else if (error.code === 'LIMIT_FILE_COUNT') {
    err = new ValidationError('Too many files');
  } else if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    err = new ValidationError('Unexpected file field');
  }

  // Redis errors
  if (error.code === 'ECONNREFUSED' && error.address === '127.0.0.1') {
    err = new ServiceUnavailableError('Cache service unavailable');
  }

  // Payment errors (Stripe)
  if (error.type === 'StripeCardError') {
    err = new ValidationError('Payment failed: ' + error.message);
  } else if (error.type === 'StripeInvalidRequestError') {
    err = new ValidationError('Invalid payment request');
  }

  // Default to AppError if not already an operational error
  if (!err.isOperational) {
    err = new AppError(
      process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
      err.statusCode || 500,
      err.code || 'INTERNAL_ERROR'
    );
  }

  // Log error based on severity
  if (err.statusCode >= 500) {
    logger.error('Server Error', { ...errorDetails, error: err });
  } else if (err.statusCode >= 400) {
    logger.warn('Client Error', { ...errorDetails, error: err });
  } else {
    logger.info('Request Error', { ...errorDetails, error: err });
  }

  // Send error response
  const response = {
    error: err.message,
    code: err.code,
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  };

  // Add additional details for validation errors
  if (err instanceof ValidationError && err.details) {
    response.details = err.details;
  }

  // Add retry information for rate limit errors
  if (err instanceof RateLimitError) {
    response.retryAfter = err.retryAfter;
    res.set('Retry-After', err.retryAfter);
  }

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  // Add request ID for tracking
  if (req.id) {
    response.requestId = req.id;
  }

  res.status(err.statusCode).json(response);
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Not found handler
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(error);
};

// Validation middleware
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const details = {};
      error.details.forEach(detail => {
        details[detail.path.join('.')] = detail.message;
      });
      
      return next(new ValidationError('Validation failed', details));
    }
    
    next();
  };
};

// Business logic error handlers
const handleServiceError = (service, operation) => {
  return (error) => {
    logger.error(`${service} ${operation} failed`, {
      service,
      operation,
      error: error.message,
      stack: error.stack
    });
    
    if (error.isOperational) {
      throw error;
    }
    
    throw new AppError(
      `${service} service is temporarily unavailable`,
      503,
      'SERVICE_ERROR'
    );
  };
};

const handleRevenueError = (error) => {
  logger.error('Revenue calculation failed', {
    error: error.message,
    stack: error.stack
  });
  
  throw new AppError(
    'Revenue calculation service is temporarily unavailable',
    503,
    'REVENUE_SERVICE_ERROR'
  );
};

const handleCascadeError = (error) => {
  logger.error('Service cascade failed', {
    error: error.message,
    stack: error.stack
  });
  
  throw new AppError(
    'Service cascade engine is temporarily unavailable',
    503,
    'CASCADE_SERVICE_ERROR'
  );
};

const handleIntegrationError = (integration, error) => {
  logger.error(`${integration} integration failed`, {
    integration,
    error: error.message,
    stack: error.stack
  });
  
  throw new AppError(
    `${integration} integration is temporarily unavailable`,
    503,
    'INTEGRATION_ERROR'
  );
};

const handleAIError = (error) => {
  logger.error('AI processing failed', {
    error: error.message,
    stack: error.stack
  });
  
  throw new AppError(
    'AI processing service is temporarily unavailable',
    503,
    'AI_SERVICE_ERROR'
  );
};

// Request timeout handler
const timeoutHandler = (timeout = 30000) => {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      const error = new AppError(
        'Request timeout',
        408,
        'REQUEST_TIMEOUT'
      );
      next(error);
    }, timeout);
    
    res.on('finish', () => {
      clearTimeout(timer);
    });
    
    res.on('close', () => {
      clearTimeout(timer);
    });
    
    next();
  };
};

// Health check error handler
const healthCheckErrorHandler = (error) => {
  logger.error('Health check failed', {
    error: error.message,
    stack: error.stack
  });
  
  return {
    status: 'unhealthy',
    error: error.message,
    timestamp: new Date().toISOString()
  };
};

// Database connection error handler
const dbErrorHandler = (error) => {
  logger.error('Database error', {
    error: error.message,
    code: error.code,
    stack: error.stack
  });
  
  if (error.code === 'ECONNREFUSED') {
    throw new ServiceUnavailableError('Database connection failed');
  }
  
  if (error.code === 'ENOTFOUND') {
    throw new ServiceUnavailableError('Database host not found');
  }
  
  throw new AppError('Database error', 500, 'DATABASE_ERROR');
};

// File upload error handler
const fileUploadErrorHandler = (error) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    throw new ValidationError('File size too large');
  }
  
  if (error.code === 'LIMIT_FILE_COUNT') {
    throw new ValidationError('Too many files uploaded');
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    throw new ValidationError('Unexpected file field');
  }
  
  throw new AppError('File upload failed', 400, 'FILE_UPLOAD_ERROR');
};

// Payment error handler
const paymentErrorHandler = (error) => {
  logger.error('Payment processing failed', {
    error: error.message,
    type: error.type,
    code: error.code
  });
  
  if (error.type === 'StripeCardError') {
    throw new ValidationError(`Payment failed: ${error.message}`);
  }
  
  if (error.type === 'StripeInvalidRequestError') {
    throw new ValidationError('Invalid payment request');
  }
  
  throw new AppError('Payment processing failed', 500, 'PAYMENT_ERROR');
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  validate,
  timeoutHandler,
  healthCheckErrorHandler,
  dbErrorHandler,
  fileUploadErrorHandler,
  paymentErrorHandler,
  handleServiceError,
  handleRevenueError,
  handleCascadeError,
  handleIntegrationError,
  handleAIError,
  
  // Error classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError
}; 