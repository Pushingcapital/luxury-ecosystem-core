const database = require('../database/connection');
const redis = require('../utils/redis');
const logger = require('../utils/logger');
const { handleCascadeError } = require('../middleware/errorHandler');

class CascadeEngine {
  constructor() {
    this.isInitialized = false;
    this.cascadeRules = new Map();
    this.conversionThreshold = parseFloat(process.env.CASCADE_TRIGGER_THRESHOLD) || 0.75;
    this.maxCascadeDepth = 3;
    this.cascadeDelayMs = 5000; // 5 seconds delay between cascades
  }

  async initialize() {
    try {
      await this.loadCascadeRules();
      this.isInitialized = true;
      logger.info('Cascade engine initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize cascade engine:', error);
      throw error;
    }
  }

  async loadCascadeRules() {
    try {
      // Load all active cascade rules from database
      const rules = await database.query(`
        SELECT 
          sc.*,
          es.name as entry_service_name,
          es.slug as entry_service_slug,
          ts.name as triggered_service_name,
          ts.slug as triggered_service_slug
        FROM service_cascades sc
        JOIN services es ON sc.entry_service_id = es.id
        JOIN services ts ON sc.triggered_service_id = ts.id
        WHERE sc.is_active = true
        ORDER BY sc.priority ASC, sc.conversion_rate DESC
      `);

      // Group rules by entry service
      this.cascadeRules.clear();
      for (const rule of rules.rows) {
        const entryServiceId = rule.entry_service_id;
        if (!this.cascadeRules.has(entryServiceId)) {
          this.cascadeRules.set(entryServiceId, []);
        }
        
        this.cascadeRules.get(entryServiceId).push({
          id: rule.id,
          entryServiceId: rule.entry_service_id,
          triggeredServiceId: rule.triggered_service_id,
          conversionRate: parseFloat(rule.conversion_rate),
          priority: rule.priority,
          conditions: rule.conditions ? JSON.parse(rule.conditions) : {},
          entryServiceName: rule.entry_service_name,
          entryServiceSlug: rule.entry_service_slug,
          triggeredServiceName: rule.triggered_service_name,
          triggeredServiceSlug: rule.triggered_service_slug
        });
      }

      logger.info(`Loaded ${rules.rows.length} cascade rules for ${this.cascadeRules.size} services`);
    } catch (error) {
      handleCascadeError(error);
    }
  }

  async triggerCascade(serviceOrderId, clientId, depth = 0) {
    try {
      if (!this.isInitialized) {
        throw new Error('Cascade engine not initialized');
      }

      if (depth >= this.maxCascadeDepth) {
        logger.warn('Maximum cascade depth reached', { serviceOrderId, clientId, depth });
        return;
      }

      // Get the completed service order
      const serviceOrder = await database.findById('service_orders', serviceOrderId);
      if (!serviceOrder || serviceOrder.status !== 'completed') {
        logger.warn('Service order not found or not completed', { serviceOrderId });
        return;
      }

      // Get cascade rules for this service
      const rules = this.cascadeRules.get(serviceOrder.service_id);
      if (!rules || rules.length === 0) {
        logger.debug('No cascade rules found for service', { 
          serviceId: serviceOrder.service_id, 
          serviceOrderId 
        });
        return;
      }

      // Get client profile for condition evaluation
      const client = await this.getClientProfile(clientId);
      if (!client) {
        logger.warn('Client not found for cascade', { clientId });
        return;
      }

      // Evaluate each rule
      for (const rule of rules) {
        try {
          // Check if conversion rate meets threshold
          if (rule.conversionRate < this.conversionThreshold) {
            logger.debug('Rule conversion rate below threshold', {
              rule: rule.id,
              conversionRate: rule.conversionRate,
              threshold: this.conversionThreshold
            });
            continue;
          }

          // Check if client already has this service
          const existingOrder = await this.checkExistingService(clientId, rule.triggeredServiceId);
          if (existingOrder) {
            logger.debug('Client already has triggered service', {
              clientId,
              serviceId: rule.triggeredServiceId,
              existingOrderId: existingOrder.id
            });
            continue;
          }

          // Evaluate conditions
          const conditionsMet = await this.evaluateConditions(rule.conditions, client, serviceOrder);
          if (!conditionsMet) {
            logger.debug('Cascade conditions not met', {
              ruleId: rule.id,
              conditions: rule.conditions,
              clientId
            });
            continue;
          }

          // Apply probability-based triggering
          const shouldTrigger = Math.random() < rule.conversionRate;
          if (!shouldTrigger) {
            logger.debug('Cascade not triggered due to probability', {
              ruleId: rule.id,
              conversionRate: rule.conversionRate
            });
            continue;
          }

          // Create cascade trigger record
          const cascadeTrigger = await database.create('cascade_triggers', {
            client_id: clientId,
            entry_order_id: serviceOrderId,
            cascade_id: rule.id,
            triggered_at: new Date(),
            converted: false
          });

          // Delay before triggering to simulate natural progression
          setTimeout(async () => {
            await this.createTriggeredService(rule, client, cascadeTrigger, depth);
          }, this.cascadeDelayMs);

          logger.cascade('Service cascade triggered', {
            clientId,
            entryService: rule.entryServiceName,
            triggeredService: rule.triggeredServiceName,
            conversionRate: rule.conversionRate,
            cascadeTrigger: cascadeTrigger.id
          });

        } catch (error) {
          logger.error('Error processing cascade rule', {
            ruleId: rule.id,
            error: error.message,
            clientId,
            serviceOrderId
          });
        }
      }

    } catch (error) {
      handleCascadeError(error);
    }
  }

  async createTriggeredService(rule, client, cascadeTrigger, depth) {
    try {
      // Get service details
      const service = await database.findById('services', rule.triggeredServiceId);
      if (!service) {
        logger.error('Triggered service not found', { serviceId: rule.triggeredServiceId });
        return;
      }

      // Calculate dynamic pricing
      const pricing = await this.calculateDynamicPricing(service, client);

      // Generate order number
      const orderNumber = await this.generateOrderNumber();

      // Create service order
      const serviceOrder = await database.create('service_orders', {
        client_id: client.id,
        service_id: service.id,
        order_number: orderNumber,
        status: 'pending',
        base_price: service.base_price,
        final_price: pricing.finalPrice,
        discount_amount: pricing.discountAmount,
        priority: rule.priority,
        service_data: JSON.stringify({
          triggeredBy: 'cascade',
          cascadeTriggerId: cascadeTrigger.id,
          originalConversionRate: rule.conversionRate,
          depth: depth + 1
        }),
        notes: `Automatically triggered by ${rule.entryServiceName} completion`
      });

      // Update cascade trigger with the created order
      await database.update('cascade_triggers', cascadeTrigger.id, {
        triggered_order_id: serviceOrder.id,
        converted: true,
        converted_at: new Date()
      });

      // Update client journey
      await this.updateClientJourney(client.id, {
        action: 'service_triggered',
        serviceId: service.id,
        serviceName: service.name,
        triggeredBy: rule.entryServiceName,
        conversionRate: rule.conversionRate
      });

      // Send notifications
      await this.sendCascadeNotifications(client, service, serviceOrder);

      // Cache the triggered service for quick access
      await redis.set(`triggered_service:${client.id}:${service.id}`, {
        orderId: serviceOrder.id,
        triggeredAt: new Date().toISOString(),
        conversionRate: rule.conversionRate
      }, 3600);

      logger.cascade('Service cascade conversion successful', {
        clientId: client.id,
        serviceId: service.id,
        serviceName: service.name,
        orderId: serviceOrder.id,
        finalPrice: pricing.finalPrice,
        cascadeTriggerId: cascadeTrigger.id
      });

      // Trigger next level cascade when this service completes
      // This will be handled by the service completion webhook

    } catch (error) {
      logger.error('Failed to create triggered service', {
        ruleId: rule.id,
        clientId: client.id,
        error: error.message
      });

      // Update cascade trigger with failure
      await database.update('cascade_triggers', cascadeTrigger.id, {
        converted: false,
        revenue_generated: 0
      });
    }
  }

  async getClientProfile(clientId) {
    try {
      // Try cache first
      const cached = await redis.get(`client_profile:${clientId}`);
      if (cached) {
        return cached;
      }

      // Get from database with related data
      const result = await database.query(`
        SELECT 
          c.*,
          u.email,
          u.first_name,
          u.last_name,
          u.phone,
          COUNT(so.id) as total_orders,
          SUM(CASE WHEN so.status = 'completed' THEN so.final_price ELSE 0 END) as total_spent,
          AVG(CASE WHEN so.status = 'completed' THEN so.final_price ELSE NULL END) as avg_order_value,
          MAX(so.completed_at) as last_order_date
        FROM clients c
        JOIN users u ON c.user_id = u.id
        LEFT JOIN service_orders so ON c.id = so.client_id
        WHERE c.id = $1
        GROUP BY c.id, u.email, u.first_name, u.last_name, u.phone
      `, [clientId]);

      if (result.rows.length === 0) {
        return null;
      }

      const client = result.rows[0];

      // Get recent vehicles
      const vehicles = await database.findMany('vehicles', { client_id: clientId }, {
        limit: 5,
        orderBy: 'created_at DESC'
      });

      // Get recent service history
      const serviceHistory = await database.query(`
        SELECT 
          so.*,
          s.name as service_name,
          s.slug as service_slug
        FROM service_orders so
        JOIN services s ON so.service_id = s.id
        WHERE so.client_id = $1
        ORDER BY so.created_at DESC
        LIMIT 10
      `, [clientId]);

      const profile = {
        ...client,
        vehicles,
        serviceHistory: serviceHistory.rows,
        totalOrders: parseInt(client.total_orders) || 0,
        totalSpent: parseFloat(client.total_spent) || 0,
        avgOrderValue: parseFloat(client.avg_order_value) || 0,
        lastOrderDate: client.last_order_date
      };

      // Cache for 30 minutes
      await redis.set(`client_profile:${clientId}`, profile, 1800);

      return profile;

    } catch (error) {
      logger.error('Failed to get client profile', { clientId, error: error.message });
      return null;
    }
  }

  async evaluateConditions(conditions, client, serviceOrder) {
    try {
      if (!conditions || Object.keys(conditions).length === 0) {
        return true; // No conditions means always trigger
      }

      // Credit score conditions
      if (conditions.min_credit_score && client.credit_score < conditions.min_credit_score) {
        return false;
      }

      if (conditions.max_credit_score && client.credit_score > conditions.max_credit_score) {
        return false;
      }

      // Vehicle value conditions
      if (conditions.min_vehicle_value && client.vehicle_value < conditions.min_vehicle_value) {
        return false;
      }

      // Income conditions
      if (conditions.min_annual_income && client.annual_income < conditions.min_annual_income) {
        return false;
      }

      // Journey stage conditions
      if (conditions.journey_stage && client.journey_stage !== conditions.journey_stage) {
        return false;
      }

      // Service-specific conditions
      if (conditions.financing_needed && !this.hasFinancingNeed(client)) {
        return false;
      }

      if (conditions.vehicle_purchase_intent && !this.hasVehiclePurchaseIntent(client)) {
        return false;
      }

      if (conditions.business_financing_needed && !this.hasBusinessFinancingNeed(client)) {
        return false;
      }

      // Vehicle condition conditions
      if (conditions.vehicle_condition_fair_or_below && !this.hasVehicleConditionIssues(client)) {
        return false;
      }

      // Time-based conditions
      if (conditions.min_days_since_last_order) {
        const daysSinceLastOrder = this.getDaysSinceLastOrder(client);
        if (daysSinceLastOrder < conditions.min_days_since_last_order) {
          return false;
        }
      }

      // Spending conditions
      if (conditions.min_total_spent && client.totalSpent < conditions.min_total_spent) {
        return false;
      }

      // Custom business logic conditions
      if (conditions.credit_score_improvement_needed && !this.needsCreditImprovement(client)) {
        return false;
      }

      if (conditions.legal_structure_complex && !this.hasComplexLegalNeeds(client)) {
        return false;
      }

      return true;

    } catch (error) {
      logger.error('Error evaluating cascade conditions', {
        conditions,
        clientId: client.id,
        error: error.message
      });
      return false;
    }
  }

  // Helper methods for condition evaluation
  hasFinancingNeed(client) {
    return client.credit_score < 700 || client.vehicle_value > 50000;
  }

  hasVehiclePurchaseIntent(client) {
    return client.journey_stage === 'consideration' || client.journey_stage === 'purchase';
  }

  hasBusinessFinancingNeed(client) {
    return client.client_type === 'business' || client.business_name;
  }

  hasVehicleConditionIssues(client) {
    return client.vehicles.some(v => ['fair', 'poor'].includes(v.condition));
  }

  getDaysSinceLastOrder(client) {
    if (!client.lastOrderDate) return 999;
    return Math.floor((Date.now() - new Date(client.lastOrderDate).getTime()) / (24 * 60 * 60 * 1000));
  }

  needsCreditImprovement(client) {
    return client.credit_score < 650;
  }

  hasComplexLegalNeeds(client) {
    return client.client_type === 'business' || client.totalSpent > 100000;
  }

  async checkExistingService(clientId, serviceId) {
    try {
      const existing = await database.findOne('service_orders', {
        client_id: clientId,
        service_id: serviceId
      });
      return existing;
    } catch (error) {
      logger.error('Error checking existing service', { clientId, serviceId, error: error.message });
      return null;
    }
  }

  async calculateDynamicPricing(service, client) {
    try {
      let basePrice = parseFloat(service.base_price);
      let finalPrice = basePrice;
      let discountAmount = 0;

      // Premium client discount
      if (client.totalSpent > 50000) {
        discountAmount = basePrice * 0.1; // 10% discount for premium clients
      }

      // High credit score discount
      if (client.credit_score > 750) {
        discountAmount = Math.max(discountAmount, basePrice * 0.05); // 5% discount for excellent credit
      }

      // First-time client discount
      if (client.totalOrders === 0) {
        discountAmount = Math.max(discountAmount, basePrice * 0.15); // 15% discount for new clients
      }

      // Volume discount
      if (client.totalOrders > 5) {
        discountAmount = Math.max(discountAmount, basePrice * 0.08); // 8% discount for loyal clients
      }

      finalPrice = Math.max(basePrice - discountAmount, basePrice * 0.5); // Minimum 50% of base price

      return {
        basePrice,
        finalPrice,
        discountAmount,
        discountPercentage: discountAmount > 0 ? (discountAmount / basePrice) * 100 : 0
      };

    } catch (error) {
      logger.error('Error calculating dynamic pricing', { 
        serviceId: service.id, 
        clientId: client.id, 
        error: error.message 
      });
      return {
        basePrice: service.base_price,
        finalPrice: service.base_price,
        discountAmount: 0,
        discountPercentage: 0
      };
    }
  }

  async generateOrderNumber() {
    const prefix = 'LAE'; // Luxury Automotive Ecosystem
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  async updateClientJourney(clientId, action) {
    try {
      await database.create('client_journey', {
        client_id: clientId,
        stage: action.action,
        touchpoints: JSON.stringify(action),
        conversion_probability: action.conversionRate || 0,
        next_recommended_action: `Complete ${action.serviceName} service`
      });
    } catch (error) {
      logger.error('Error updating client journey', { clientId, error: error.message });
    }
  }

  async sendCascadeNotifications(client, service, serviceOrder) {
    try {
      // Send to client
      const clientNotification = {
        type: 'service_recommended',
        title: `New Service Recommended: ${service.name}`,
        message: `Based on your recent activity, we recommend our ${service.name} service.`,
        data: {
          serviceId: service.id,
          orderId: serviceOrder.id,
          finalPrice: serviceOrder.final_price
        }
      };

      await redis.queueNotification(client.user_id, clientNotification);

      // Send to admin team
      const adminNotification = {
        type: 'cascade_triggered',
        title: 'Service Cascade Triggered',
        message: `${client.first_name} ${client.last_name} has been recommended ${service.name}`,
        data: {
          clientId: client.id,
          serviceId: service.id,
          orderId: serviceOrder.id
        }
      };

      // Queue for all admin users
      const adminUsers = await database.findMany('users', { role: 'admin' });
      for (const admin of adminUsers) {
        await redis.queueNotification(admin.id, adminNotification);
      }

    } catch (error) {
      logger.error('Error sending cascade notifications', { 
        clientId: client.id, 
        serviceId: service.id, 
        error: error.message 
      });
    }
  }

  async getCascadeMetrics(timeframe = '30d') {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_triggers,
          COUNT(CASE WHEN converted = true THEN 1 END) as successful_conversions,
          AVG(CASE WHEN converted = true THEN revenue_generated ELSE 0 END) as avg_revenue,
          SUM(CASE WHEN converted = true THEN revenue_generated ELSE 0 END) as total_revenue
        FROM cascade_triggers
        WHERE triggered_at >= NOW() - INTERVAL '${timeframe}'
      `;

      const result = await database.query(query);
      const metrics = result.rows[0];

      return {
        totalTriggers: parseInt(metrics.total_triggers),
        successfulConversions: parseInt(metrics.successful_conversions),
        conversionRate: metrics.total_triggers > 0 ? 
          (metrics.successful_conversions / metrics.total_triggers) * 100 : 0,
        avgRevenue: parseFloat(metrics.avg_revenue) || 0,
        totalRevenue: parseFloat(metrics.total_revenue) || 0
      };

    } catch (error) {
      logger.error('Error getting cascade metrics', { error: error.message });
      return {
        totalTriggers: 0,
        successfulConversions: 0,
        conversionRate: 0,
        avgRevenue: 0,
        totalRevenue: 0
      };
    }
  }

  async optimizeCascadeRules() {
    try {
      logger.info('Starting cascade rule optimization...');

      // Get performance data for each rule
      const performanceQuery = `
        SELECT 
          sc.id,
          sc.conversion_rate as expected_rate,
          COUNT(ct.id) as total_triggers,
          COUNT(CASE WHEN ct.converted = true THEN 1 END) as successful_conversions,
          AVG(CASE WHEN ct.converted = true THEN ct.revenue_generated ELSE 0 END) as avg_revenue
        FROM service_cascades sc
        LEFT JOIN cascade_triggers ct ON sc.id = ct.cascade_id
        WHERE ct.triggered_at >= NOW() - INTERVAL '30 days'
        GROUP BY sc.id, sc.conversion_rate
        HAVING COUNT(ct.id) >= 10
      `;

      const results = await database.query(performanceQuery);

      for (const row of results.rows) {
        const actualRate = row.total_triggers > 0 ? 
          row.successful_conversions / row.total_triggers : 0;
        const expectedRate = parseFloat(row.expected_rate);

        // Update conversion rate if significantly different
        if (Math.abs(actualRate - expectedRate) > 0.1) {
          await database.update('service_cascades', row.id, {
            conversion_rate: actualRate
          });

          logger.info('Updated cascade rule conversion rate', {
            ruleId: row.id,
            oldRate: expectedRate,
            newRate: actualRate,
            totalTriggers: row.total_triggers,
            successfulConversions: row.successful_conversions
          });
        }
      }

      // Reload rules after optimization
      await this.loadCascadeRules();

      logger.info('Cascade rule optimization completed');

    } catch (error) {
      logger.error('Error optimizing cascade rules', { error: error.message });
    }
  }
}

module.exports = CascadeEngine; 