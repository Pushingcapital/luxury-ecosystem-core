const express = require('express');
const Joi = require('joi');
const { asyncHandler, validate } = require('../middleware/errorHandler');
const { authenticate, authorize, authorizeResource } = require('../middleware/auth');
const logger = require('../utils/logger');
const database = require('../database/connection');
const redis = require('../utils/redis');

const router = express.Router();

// Validation schemas
const serviceOrderSchema = Joi.object({
  serviceId: Joi.string().uuid().required(),
  vehicleId: Joi.string().uuid().optional(),
  urgency: Joi.string().valid('standard', 'expedited', 'emergency').default('standard'),
  notes: Joi.string().max(1000).optional(),
  serviceData: Joi.object().optional()
});

const updateOrderSchema = Joi.object({
  status: Joi.string().valid('pending', 'in_progress', 'completed', 'cancelled').optional(),
  notes: Joi.string().max(1000).optional(),
  serviceData: Joi.object().optional()
});

const creditAnalysisSchema = Joi.object({
  currentScore: Joi.number().min(300).max(850).required(),
  targetScore: Joi.number().min(300).max(850).required(),
  timelineMonths: Joi.number().min(1).max(36).required(),
  goals: Joi.array().items(Joi.string()).optional()
});

const loanApplicationSchema = Joi.object({
  loanAmount: Joi.number().positive().required(),
  downPayment: Joi.number().min(0).optional(),
  termMonths: Joi.number().valid(12, 24, 36, 48, 60, 72, 84).required(),
  purpose: Joi.string().max(200).required(),
  vehicleId: Joi.string().uuid().optional()
});

const vehicleInspectionSchema = Joi.object({
  inspectionType: Joi.string().valid(
    'pre_purchase', 'insurance', 'warranty', 'appraisal', 'accident', 
    'maintenance', 'emissions', 'safety', 'auction', 'export', 'custom'
  ).required(),
  location: Joi.string().max(200).required(),
  preferredDate: Joi.date().min('now').required(),
  specialInstructions: Joi.string().max(500).optional()
});

const transportOrderSchema = Joi.object({
  pickupLocation: Joi.string().max(200).required(),
  deliveryLocation: Joi.string().max(200).required(),
  pickupDate: Joi.date().min('now').required(),
  transportType: Joi.string().valid('open', 'enclosed', 'expedited').default('open'),
  insuranceCoverage: Joi.number().positive().optional(),
  specialInstructions: Joi.string().max(500).optional()
});

/**
 * @swagger
 * /api/services:
 *   get:
 *     summary: Get all available services
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by service category
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of services retrieved successfully
 */
router.get('/',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      const { category, active } = req.query;
      
      let query = `
        SELECT 
          s.*,
          COUNT(so.id) as total_orders,
          AVG(CASE WHEN so.status = 'completed' THEN so.final_price ELSE NULL END) as avg_price,
          SUM(CASE WHEN so.status = 'completed' THEN so.final_price ELSE 0 END) as total_revenue
        FROM services s
        LEFT JOIN service_orders so ON s.id = so.service_id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (category) {
        query += ` AND s.service_category = $${params.length + 1}`;
        params.push(category);
      }
      
      if (active !== undefined) {
        query += ` AND s.is_active = $${params.length + 1}`;
        params.push(active === 'true');
      }
      
      query += `
        GROUP BY s.id
        ORDER BY s.name ASC
      `;
      
      const result = await database.query(query, params);
      
      // Get client's pricing for each service
      const clientId = req.user.id;
      const revenueOptimizer = req.app.get('revenueOptimizer');
      
      const servicesWithPricing = await Promise.all(
        result.rows.map(async (service) => {
          let pricing = null;
          
          if (revenueOptimizer) {
            try {
              pricing = await revenueOptimizer.calculateOptimalPrice(service.id, clientId);
            } catch (error) {
              logger.error('Error calculating pricing for service', {
                serviceId: service.id,
                clientId,
                error: error.message
              });
            }
          }
          
          return {
            id: service.id,
            name: service.name,
            slug: service.slug,
            description: service.description,
            category: service.service_category,
            basePrice: parseFloat(service.base_price),
            finalPrice: pricing?.finalPrice || parseFloat(service.base_price),
            isActive: service.is_active,
            annualRevenueTarget: parseFloat(service.annual_revenue_target),
            stats: {
              totalOrders: parseInt(service.total_orders) || 0,
              avgPrice: parseFloat(service.avg_price) || 0,
              totalRevenue: parseFloat(service.total_revenue) || 0
            },
            pricing: pricing ? {
              discountAmount: pricing.discountAmount,
              premiumAmount: pricing.premiumAmount,
              adjustmentFactors: pricing.adjustmentFactors,
              profitMargin: pricing.profitMargin
            } : null
          };
        })
      );
      
      res.json({
        success: true,
        services: servicesWithPricing,
        totalCount: servicesWithPricing.length
      });
      
    } catch (error) {
      logger.error('Error getting services', {
        error: error.message,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve services',
        code: 'SERVICES_RETRIEVAL_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/services/{serviceId}:
 *   get:
 *     summary: Get service details
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Service details retrieved successfully
 *       404:
 *         description: Service not found
 */
router.get('/:serviceId',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      const { serviceId } = req.params;
      
      const service = await database.findById('services', serviceId);
      if (!service) {
        return res.status(404).json({
          success: false,
          error: 'Service not found',
          code: 'SERVICE_NOT_FOUND'
        });
      }
      
      // Get pricing for this client
      const revenueOptimizer = req.app.get('revenueOptimizer');
      let pricing = null;
      
      if (revenueOptimizer) {
        try {
          pricing = await revenueOptimizer.calculateOptimalPrice(serviceId, req.user.id);
        } catch (error) {
          logger.error('Error calculating pricing', {
            serviceId,
            clientId: req.user.id,
            error: error.message
          });
        }
      }
      
      // Get cascade rules for this service
      const cascadeRules = await database.query(`
        SELECT 
          sc.*,
          ts.name as triggered_service_name,
          ts.slug as triggered_service_slug
        FROM service_cascades sc
        JOIN services ts ON sc.triggered_service_id = ts.id
        WHERE sc.entry_service_id = $1 AND sc.is_active = true
        ORDER BY sc.priority ASC, sc.conversion_rate DESC
      `, [serviceId]);
      
      res.json({
        success: true,
        service: {
          id: service.id,
          name: service.name,
          slug: service.slug,
          description: service.description,
          category: service.service_category,
          basePrice: parseFloat(service.base_price),
          finalPrice: pricing?.finalPrice || parseFloat(service.base_price),
          isActive: service.is_active,
          annualRevenueTarget: parseFloat(service.annual_revenue_target),
          pricing: pricing ? {
            discountAmount: pricing.discountAmount,
            premiumAmount: pricing.premiumAmount,
            adjustmentFactors: pricing.adjustmentFactors,
            profitMargin: pricing.profitMargin,
            estimatedCost: pricing.estimatedCost
          } : null,
          cascadeRules: cascadeRules.rows.map(rule => ({
            id: rule.id,
            triggeredServiceName: rule.triggered_service_name,
            triggeredServiceSlug: rule.triggered_service_slug,
            conversionRate: parseFloat(rule.conversion_rate),
            priority: rule.priority,
            conditions: rule.conditions ? JSON.parse(rule.conditions) : {}
          }))
        }
      });
      
    } catch (error) {
      logger.error('Error getting service details', {
        serviceId: req.params.serviceId,
        error: error.message,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve service details',
        code: 'SERVICE_DETAILS_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/services/orders:
 *   post:
 *     summary: Create a new service order
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               serviceId:
 *                 type: string
 *                 format: uuid
 *               vehicleId:
 *                 type: string
 *                 format: uuid
 *               urgency:
 *                 type: string
 *                 enum: [standard, expedited, emergency]
 *               notes:
 *                 type: string
 *               serviceData:
 *                 type: object
 *     responses:
 *       201:
 *         description: Service order created successfully
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Service not found
 */
router.post('/orders',
  authenticate,
  validate(serviceOrderSchema),
  asyncHandler(async (req, res) => {
    try {
      const { serviceId, vehicleId, urgency, notes, serviceData } = req.body;
      
      // Verify service exists
      const service = await database.findById('services', serviceId);
      if (!service) {
        return res.status(404).json({
          success: false,
          error: 'Service not found',
          code: 'SERVICE_NOT_FOUND'
        });
      }
      
      // Get client ID
      const client = await database.findOne('clients', { user_id: req.user.id });
      if (!client) {
        return res.status(404).json({
          success: false,
          error: 'Client profile not found',
          code: 'CLIENT_NOT_FOUND'
        });
      }
      
      // Calculate optimal pricing
      const revenueOptimizer = req.app.get('revenueOptimizer');
      let pricing = {
        finalPrice: parseFloat(service.base_price),
        discountAmount: 0
      };
      
      if (revenueOptimizer) {
        try {
          pricing = await revenueOptimizer.calculateOptimalPrice(serviceId, client.id, { urgency });
        } catch (error) {
          logger.error('Error calculating pricing for order', {
            serviceId,
            clientId: client.id,
            error: error.message
          });
        }
      }
      
      // Generate order number
      const orderNumber = await generateOrderNumber();
      
      // Create service order
      const serviceOrder = await database.create('service_orders', {
        client_id: client.id,
        service_id: serviceId,
        vehicle_id: vehicleId,
        order_number: orderNumber,
        status: 'pending',
        base_price: service.base_price,
        final_price: pricing.finalPrice,
        discount_amount: pricing.discountAmount,
        service_data: serviceData ? JSON.stringify(serviceData) : null,
        notes
      });
      
      // Log order creation
      logger.revenue('Service order created', {
        orderId: serviceOrder.id,
        clientId: client.id,
        serviceId,
        serviceName: service.name,
        finalPrice: pricing.finalPrice,
        urgency
      });
      
      res.status(201).json({
        success: true,
        message: 'Service order created successfully',
        order: {
          id: serviceOrder.id,
          orderNumber: serviceOrder.order_number,
          status: serviceOrder.status,
          service: {
            id: service.id,
            name: service.name,
            slug: service.slug
          },
          pricing: {
            basePrice: parseFloat(service.base_price),
            finalPrice: pricing.finalPrice,
            discountAmount: pricing.discountAmount
          },
          createdAt: serviceOrder.created_at
        }
      });
      
    } catch (error) {
      logger.error('Error creating service order', {
        error: error.message,
        userId: req.user.id,
        serviceId: req.body.serviceId
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to create service order',
        code: 'ORDER_CREATION_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/services/orders/{orderId}:
 *   get:
 *     summary: Get service order details
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Service order details retrieved successfully
 *       404:
 *         description: Order not found
 */
router.get('/orders/:orderId',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      const { orderId } = req.params;
      
      const orderQuery = `
        SELECT 
          so.*,
          s.name as service_name,
          s.slug as service_slug,
          s.description as service_description,
          c.id as client_id,
          u.first_name,
          u.last_name,
          u.email,
          v.make,
          v.model,
          v.year,
          v.vin
        FROM service_orders so
        JOIN services s ON so.service_id = s.id
        JOIN clients c ON so.client_id = c.id
        JOIN users u ON c.user_id = u.id
        LEFT JOIN vehicles v ON so.vehicle_id = v.id
        WHERE so.id = $1
      `;
      
      const result = await database.query(orderQuery, [orderId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Order not found',
          code: 'ORDER_NOT_FOUND'
        });
      }
      
      const order = result.rows[0];
      
      // Check authorization
      if (req.user.role === 'client' && order.client_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          code: 'ACCESS_DENIED'
        });
      }
      
      // Get service-specific data based on service type
      let serviceSpecificData = null;
      
      switch (order.service_slug) {
        case 'credit-analysis':
          serviceSpecificData = await getCreditAnalysisData(orderId);
          break;
        case 'loan-optimization':
          serviceSpecificData = await getLoanApplicationData(orderId);
          break;
        case 'vehicle-inspection':
          serviceSpecificData = await getVehicleInspectionData(orderId);
          break;
        case 'vehicle-transport':
          serviceSpecificData = await getTransportOrderData(orderId);
          break;
        default:
          serviceSpecificData = order.service_data ? JSON.parse(order.service_data) : null;
      }
      
      res.json({
        success: true,
        order: {
          id: order.id,
          orderNumber: order.order_number,
          status: order.status,
          service: {
            id: order.service_id,
            name: order.service_name,
            slug: order.service_slug,
            description: order.service_description
          },
          client: {
            id: order.client_id,
            firstName: order.first_name,
            lastName: order.last_name,
            email: order.email
          },
          vehicle: order.vehicle_id ? {
            id: order.vehicle_id,
            make: order.make,
            model: order.model,
            year: order.year,
            vin: order.vin
          } : null,
          pricing: {
            basePrice: parseFloat(order.base_price),
            finalPrice: parseFloat(order.final_price),
            discountAmount: parseFloat(order.discount_amount),
            taxAmount: parseFloat(order.tax_amount) || 0
          },
          serviceData: serviceSpecificData,
          notes: order.notes,
          createdAt: order.created_at,
          startedAt: order.started_at,
          completedAt: order.completed_at,
          estimatedCompletion: order.estimated_completion
        }
      });
      
    } catch (error) {
      logger.error('Error getting order details', {
        orderId: req.params.orderId,
        error: error.message,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve order details',
        code: 'ORDER_DETAILS_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/services/orders/{orderId}:
 *   put:
 *     summary: Update service order
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, in_progress, completed, cancelled]
 *               notes:
 *                 type: string
 *               serviceData:
 *                 type: object
 *     responses:
 *       200:
 *         description: Order updated successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Order not found
 */
router.put('/orders/:orderId',
  authenticate,
  validate(updateOrderSchema),
  asyncHandler(async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status, notes, serviceData } = req.body;
      
      // Get current order
      const currentOrder = await database.findById('service_orders', orderId);
      if (!currentOrder) {
        return res.status(404).json({
          success: false,
          error: 'Order not found',
          code: 'ORDER_NOT_FOUND'
        });
      }
      
      // Check authorization
      if (req.user.role === 'client') {
        // Clients can only update notes and cancel orders
        if (status && status !== 'cancelled') {
          return res.status(403).json({
            success: false,
            error: 'Clients can only cancel orders',
            code: 'INSUFFICIENT_PERMISSIONS'
          });
        }
      }
      
      // Prepare update data
      const updateData = {};
      
      if (status) {
        updateData.status = status;
        
        if (status === 'in_progress' && !currentOrder.started_at) {
          updateData.started_at = new Date();
        }
        
        if (status === 'completed' && !currentOrder.completed_at) {
          updateData.completed_at = new Date();
        }
        
        if (status === 'cancelled' && !currentOrder.cancelled_at) {
          updateData.cancelled_at = new Date();
        }
      }
      
      if (notes) {
        updateData.notes = notes;
      }
      
      if (serviceData) {
        updateData.service_data = JSON.stringify(serviceData);
      }
      
      // Update order
      const updatedOrder = await database.update('service_orders', orderId, updateData);
      
      // Handle service completion
      if (status === 'completed' && currentOrder.status !== 'completed') {
        await handleServiceCompletion(orderId, currentOrder.client_id, req.app);
      }
      
      logger.audit('Service order updated', {
        orderId,
        previousStatus: currentOrder.status,
        newStatus: status,
        updatedBy: req.user.id
      });
      
      res.json({
        success: true,
        message: 'Order updated successfully',
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          notes: updatedOrder.notes,
          startedAt: updatedOrder.started_at,
          completedAt: updatedOrder.completed_at,
          updatedAt: updatedOrder.updated_at
        }
      });
      
    } catch (error) {
      logger.error('Error updating order', {
        orderId: req.params.orderId,
        error: error.message,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to update order',
        code: 'ORDER_UPDATE_FAILED'
      });
    }
  })
);

// Service-specific endpoints

/**
 * @swagger
 * /api/services/credit-analysis:
 *   post:
 *     summary: Submit credit analysis request
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               currentScore:
 *                 type: number
 *                 minimum: 300
 *                 maximum: 850
 *               targetScore:
 *                 type: number
 *                 minimum: 300
 *                 maximum: 850
 *               timelineMonths:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 36
 *               goals:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Credit analysis request submitted successfully
 */
router.post('/credit-analysis',
  authenticate,
  validate(creditAnalysisSchema),
  asyncHandler(async (req, res) => {
    try {
      const { currentScore, targetScore, timelineMonths, goals } = req.body;
      
      // Get credit analysis service
      const service = await database.findOne('services', { slug: 'credit-analysis' });
      if (!service) {
        return res.status(404).json({
          success: false,
          error: 'Credit analysis service not available',
          code: 'SERVICE_NOT_AVAILABLE'
        });
      }
      
      // Get client
      const client = await database.findOne('clients', { user_id: req.user.id });
      
      // Create service order
      const orderNumber = await generateOrderNumber();
      const serviceOrder = await database.create('service_orders', {
        client_id: client.id,
        service_id: service.id,
        order_number: orderNumber,
        status: 'pending',
        base_price: service.base_price,
        final_price: service.base_price, // TODO: Apply dynamic pricing
        service_data: JSON.stringify({
          currentScore,
          targetScore,
          timelineMonths,
          goals
        })
      });
      
      // Create credit analysis record
      const creditAnalysis = await database.create('credit_analyses', {
        client_id: client.id,
        order_id: serviceOrder.id,
        current_score: currentScore,
        target_score: targetScore,
        timeline_months: timelineMonths,
        estimated_improvement: Math.min(targetScore - currentScore, 100)
      });
      
      res.status(201).json({
        success: true,
        message: 'Credit analysis request submitted successfully',
        order: {
          id: serviceOrder.id,
          orderNumber: serviceOrder.order_number,
          status: serviceOrder.status,
          finalPrice: parseFloat(serviceOrder.final_price)
        },
        analysisId: creditAnalysis.id
      });
      
    } catch (error) {
      logger.error('Error submitting credit analysis request', {
        error: error.message,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to submit credit analysis request',
        code: 'CREDIT_ANALYSIS_FAILED'
      });
    }
  })
);

/**
 * @swagger
 * /api/services/loan-application:
 *   post:
 *     summary: Submit loan application
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loanAmount:
 *                 type: number
 *               downPayment:
 *                 type: number
 *               termMonths:
 *                 type: number
 *               purpose:
 *                 type: string
 *               vehicleId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Loan application submitted successfully
 */
router.post('/loan-application',
  authenticate,
  validate(loanApplicationSchema),
  asyncHandler(async (req, res) => {
    try {
      const { loanAmount, downPayment, termMonths, purpose, vehicleId } = req.body;
      
      // Get loan optimization service
      const service = await database.findOne('services', { slug: 'loan-optimization' });
      if (!service) {
        return res.status(404).json({
          success: false,
          error: 'Loan optimization service not available',
          code: 'SERVICE_NOT_AVAILABLE'
        });
      }
      
      // Get client
      const client = await database.findOne('clients', { user_id: req.user.id });
      
      // Create service order
      const orderNumber = await generateOrderNumber();
      const serviceOrder = await database.create('service_orders', {
        client_id: client.id,
        service_id: service.id,
        vehicle_id: vehicleId,
        order_number: orderNumber,
        status: 'pending',
        base_price: service.base_price,
        final_price: service.base_price, // TODO: Apply dynamic pricing
        service_data: JSON.stringify({
          loanAmount,
          downPayment,
          termMonths,
          purpose
        })
      });
      
      // Create loan application record
      const loanApplication = await database.create('loan_applications', {
        client_id: client.id,
        vehicle_id: vehicleId,
        order_id: serviceOrder.id,
        loan_amount: loanAmount,
        down_payment: downPayment,
        term_months: termMonths,
        application_data: JSON.stringify({ purpose })
      });
      
      res.status(201).json({
        success: true,
        message: 'Loan application submitted successfully',
        order: {
          id: serviceOrder.id,
          orderNumber: serviceOrder.order_number,
          status: serviceOrder.status,
          finalPrice: parseFloat(serviceOrder.final_price)
        },
        applicationId: loanApplication.id
      });
      
    } catch (error) {
      logger.error('Error submitting loan application', {
        error: error.message,
        userId: req.user.id
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to submit loan application',
        code: 'LOAN_APPLICATION_FAILED'
      });
    }
  })
);

// Helper functions
async function generateOrderNumber() {
  const prefix = 'LAE';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

async function handleServiceCompletion(orderId, clientId, app) {
  try {
    // Track revenue
    const order = await database.findById('service_orders', orderId);
    const revenueOptimizer = app.get('revenueOptimizer');
    
    if (revenueOptimizer) {
      await revenueOptimizer.trackRevenue(orderId, order.final_price, order.service_id, clientId);
    }
    
    // Trigger service cascade
    const cascadeEngine = app.get('cascadeEngine');
    if (cascadeEngine) {
      await cascadeEngine.triggerCascade(orderId, clientId);
    }
    
    logger.revenue('Service completed', {
      orderId,
      clientId,
      revenue: order.final_price
    });
    
  } catch (error) {
    logger.error('Error handling service completion', {
      orderId,
      clientId,
      error: error.message
    });
  }
}

async function getCreditAnalysisData(orderId) {
  try {
    const result = await database.query(`
      SELECT * FROM credit_analyses WHERE order_id = $1
    `, [orderId]);
    
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting credit analysis data', { orderId, error: error.message });
    return null;
  }
}

async function getLoanApplicationData(orderId) {
  try {
    const result = await database.query(`
      SELECT * FROM loan_applications WHERE order_id = $1
    `, [orderId]);
    
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting loan application data', { orderId, error: error.message });
    return null;
  }
}

async function getVehicleInspectionData(orderId) {
  try {
    const result = await database.query(`
      SELECT * FROM vehicle_inspections WHERE order_id = $1
    `, [orderId]);
    
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting vehicle inspection data', { orderId, error: error.message });
    return null;
  }
}

async function getTransportOrderData(orderId) {
  try {
    const result = await database.query(`
      SELECT * FROM transport_orders WHERE order_id = $1
    `, [orderId]);
    
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting transport order data', { orderId, error: error.message });
    return null;
  }
}

module.exports = router; 