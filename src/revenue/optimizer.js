const database = require('../database/connection');
const redis = require('../utils/redis');
const logger = require('../utils/logger');
const { handleRevenueError } = require('../middleware/errorHandler');

class RevenueOptimizer {
  constructor() {
    this.isInitialized = false;
    this.annualRevenueTarget = 284600000; // $284.6M
    this.dynamicPricingEnabled = process.env.DYNAMIC_PRICING_ENABLED === 'true';
    this.profitMarginTarget = 0.65; // 65% profit margin
    this.priceAdjustmentCap = 0.3; // Max 30% price adjustment
    this.seasonalFactors = new Map();
    this.marketConditions = new Map();
  }

  async initialize() {
    try {
      await this.loadPricingRules();
      await this.loadSeasonalFactors();
      await this.loadMarketConditions();
      this.isInitialized = true;
      logger.info('Revenue optimizer initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize revenue optimizer:', error);
      throw error;
    }
  }

  async loadPricingRules() {
    try {
      // Load dynamic pricing rules from database or cache
      const cached = await redis.get('pricing_rules');
      if (cached) {
        this.pricingRules = cached;
        return;
      }

      // Default pricing rules
      this.pricingRules = {
        creditScoreMultipliers: {
          excellent: 1.0,    // 750+
          good: 1.05,        // 650-749
          fair: 1.1,         // 550-649
          poor: 1.15,        // 450-549
          bad: 1.2           // <450
        },
        vehicleValueMultipliers: {
          luxury: 1.15,      // $100k+
          premium: 1.1,      // $50k-99k
          standard: 1.0,     // $25k-49k
          economy: 0.95      // <$25k
        },
        loyaltyDiscounts: {
          new: 0.85,         // First-time clients
          returning: 0.95,   // 2-3 orders
          loyal: 0.9,        // 4-10 orders
          premium: 0.85      // 10+ orders
        },
        volumeDiscounts: {
          single: 1.0,
          bundle: 0.92,      // 2-3 services
          package: 0.85      // 4+ services
        },
        urgencyPremiums: {
          standard: 1.0,
          expedited: 1.25,
          emergency: 1.5
        }
      };

      // Cache for 1 hour
      await redis.set('pricing_rules', this.pricingRules, 3600);
      logger.info('Pricing rules loaded and cached');

    } catch (error) {
      logger.error('Error loading pricing rules:', error);
      throw error;
    }
  }

  async loadSeasonalFactors() {
    try {
      const currentMonth = new Date().getMonth() + 1;
      
      // Seasonal demand factors by service category
      this.seasonalFactors.set('financial', {
        1: 1.2,  // January - tax season
        2: 1.15, // February
        3: 1.1,  // March
        4: 1.0,  // April
        5: 0.95, // May
        6: 0.9,  // June
        7: 0.9,  // July
        8: 0.95, // August
        9: 1.05, // September
        10: 1.1, // October
        11: 1.15, // November - holiday prep
        12: 1.25  // December - year-end
      });

      this.seasonalFactors.set('inspection', {
        1: 0.9,  // January
        2: 0.95, // February
        3: 1.1,  // March - spring prep
        4: 1.2,  // April - peak season
        5: 1.15, // May
        6: 1.1,  // June
        7: 1.05, // July
        8: 1.0,  // August
        9: 1.1,  // September
        10: 1.15, // October
        11: 1.0,  // November
        12: 0.9   // December
      });

      this.seasonalFactors.set('transport', {
        1: 0.9,  // January
        2: 0.95, // February
        3: 1.1,  // March
        4: 1.15, // April
        5: 1.2,  // May - peak moving season
        6: 1.25, // June
        7: 1.2,  // July
        8: 1.15, // August
        9: 1.1,  // September
        10: 1.0, // October
        11: 0.95, // November
        12: 0.9   // December
      });

      logger.info('Seasonal factors loaded for current month:', currentMonth);

    } catch (error) {
      logger.error('Error loading seasonal factors:', error);
      throw error;
    }
  }

  async loadMarketConditions() {
    try {
      // Load market conditions from external APIs or cache
      const cached = await redis.get('market_conditions');
      if (cached) {
        this.marketConditions = new Map(Object.entries(cached));
        return;
      }

      // Default market conditions
      this.marketConditions.set('economy', {
        factor: 1.0,
        trend: 'stable',
        lastUpdated: new Date().toISOString()
      });

      this.marketConditions.set('automotive', {
        factor: 1.05,
        trend: 'growing',
        lastUpdated: new Date().toISOString()
      });

      this.marketConditions.set('credit', {
        factor: 0.98,
        trend: 'tightening',
        lastUpdated: new Date().toISOString()
      });

      // Cache for 4 hours
      await redis.set('market_conditions', Object.fromEntries(this.marketConditions), 14400);
      logger.info('Market conditions loaded and cached');

    } catch (error) {
      logger.error('Error loading market conditions:', error);
      throw error;
    }
  }

  async calculateOptimalPrice(serviceId, clientId, options = {}) {
    try {
      if (!this.isInitialized) {
        throw new Error('Revenue optimizer not initialized');
      }

      // Get service details
      const service = await database.findById('services', serviceId);
      if (!service) {
        throw new Error('Service not found');
      }

      // Get client profile
      const client = await this.getClientProfile(clientId);
      if (!client) {
        throw new Error('Client not found');
      }

      let basePrice = parseFloat(service.base_price);
      let finalPrice = basePrice;
      let adjustmentFactors = [];

      // Apply dynamic pricing if enabled
      if (this.dynamicPricingEnabled) {
        // Credit score adjustment
        const creditFactor = this.getCreditScoreFactor(client.credit_score);
        finalPrice *= creditFactor;
        adjustmentFactors.push({
          type: 'credit_score',
          factor: creditFactor,
          description: `Credit score: ${client.credit_score}`
        });

        // Vehicle value adjustment
        const vehicleFactor = this.getVehicleValueFactor(client.vehicle_value);
        finalPrice *= vehicleFactor;
        adjustmentFactors.push({
          type: 'vehicle_value',
          factor: vehicleFactor,
          description: `Vehicle value: $${client.vehicle_value?.toLocaleString()}`
        });

        // Loyalty adjustment
        const loyaltyFactor = this.getLoyaltyFactor(client.services_count);
        finalPrice *= loyaltyFactor;
        adjustmentFactors.push({
          type: 'loyalty',
          factor: loyaltyFactor,
          description: `${client.services_count} previous services`
        });

        // Seasonal adjustment
        const seasonalFactor = this.getSeasonalFactor(service.service_category);
        finalPrice *= seasonalFactor;
        adjustmentFactors.push({
          type: 'seasonal',
          factor: seasonalFactor,
          description: `${service.service_category} seasonal demand`
        });

        // Market conditions adjustment
        const marketFactor = this.getMarketFactor(service.service_category);
        finalPrice *= marketFactor;
        adjustmentFactors.push({
          type: 'market',
          factor: marketFactor,
          description: `Market conditions for ${service.service_category}`
        });

        // Urgency premium
        if (options.urgency) {
          const urgencyFactor = this.pricingRules.urgencyPremiums[options.urgency] || 1.0;
          finalPrice *= urgencyFactor;
          adjustmentFactors.push({
            type: 'urgency',
            factor: urgencyFactor,
            description: `${options.urgency} service`
          });
        }

        // Volume discount for multiple services
        if (options.bundleSize && options.bundleSize > 1) {
          const volumeFactor = this.getVolumeFactor(options.bundleSize);
          finalPrice *= volumeFactor;
          adjustmentFactors.push({
            type: 'volume',
            factor: volumeFactor,
            description: `Bundle of ${options.bundleSize} services`
          });
        }
      }

      // Apply price adjustment cap
      const maxPrice = basePrice * (1 + this.priceAdjustmentCap);
      const minPrice = basePrice * (1 - this.priceAdjustmentCap);
      finalPrice = Math.min(Math.max(finalPrice, minPrice), maxPrice);

      // Calculate profit margin
      const estimatedCost = this.estimateServiceCost(service, client);
      const profitMargin = (finalPrice - estimatedCost) / finalPrice;

      const pricing = {
        basePrice,
        finalPrice: Math.round(finalPrice * 100) / 100,
        adjustmentFactors,
        estimatedCost,
        profitMargin,
        discountAmount: Math.max(0, basePrice - finalPrice),
        premiumAmount: Math.max(0, finalPrice - basePrice),
        totalAdjustment: (finalPrice - basePrice) / basePrice
      };

      // Log pricing calculation
      logger.revenue('Price calculated', {
        serviceId,
        serviceName: service.name,
        clientId,
        basePrice,
        finalPrice: pricing.finalPrice,
        profitMargin,
        adjustmentFactors: adjustmentFactors.length
      });

      return pricing;

    } catch (error) {
      handleRevenueError(error);
    }
  }

  getCreditScoreFactor(creditScore) {
    if (!creditScore) return 1.0;
    
    if (creditScore >= 750) return this.pricingRules.creditScoreMultipliers.excellent;
    if (creditScore >= 650) return this.pricingRules.creditScoreMultipliers.good;
    if (creditScore >= 550) return this.pricingRules.creditScoreMultipliers.fair;
    if (creditScore >= 450) return this.pricingRules.creditScoreMultipliers.poor;
    return this.pricingRules.creditScoreMultipliers.bad;
  }

  getVehicleValueFactor(vehicleValue) {
    if (!vehicleValue) return 1.0;
    
    if (vehicleValue >= 100000) return this.pricingRules.vehicleValueMultipliers.luxury;
    if (vehicleValue >= 50000) return this.pricingRules.vehicleValueMultipliers.premium;
    if (vehicleValue >= 25000) return this.pricingRules.vehicleValueMultipliers.standard;
    return this.pricingRules.vehicleValueMultipliers.economy;
  }

  getLoyaltyFactor(servicesCount) {
    if (!servicesCount || servicesCount === 0) return this.pricingRules.loyaltyDiscounts.new;
    if (servicesCount <= 3) return this.pricingRules.loyaltyDiscounts.returning;
    if (servicesCount <= 10) return this.pricingRules.loyaltyDiscounts.loyal;
    return this.pricingRules.loyaltyDiscounts.premium;
  }

  getVolumeFactor(bundleSize) {
    if (bundleSize >= 4) return this.pricingRules.volumeDiscounts.package;
    if (bundleSize >= 2) return this.pricingRules.volumeDiscounts.bundle;
    return this.pricingRules.volumeDiscounts.single;
  }

  getSeasonalFactor(serviceCategory) {
    const currentMonth = new Date().getMonth() + 1;
    const factors = this.seasonalFactors.get(serviceCategory);
    return factors ? factors[currentMonth] || 1.0 : 1.0;
  }

  getMarketFactor(serviceCategory) {
    const conditions = this.marketConditions.get(serviceCategory);
    return conditions ? conditions.factor : 1.0;
  }

  estimateServiceCost(service, client) {
    // Base cost estimation (35% of base price as default)
    let baseCost = parseFloat(service.base_price) * 0.35;
    
    // Adjust based on service complexity
    const complexityFactors = {
      'financial': 1.2,
      'legal': 1.3,
      'inspection': 0.8,
      'transport': 0.9,
      'administrative': 0.7,
      'maintenance': 1.1,
      'parts': 0.6,
      'purchase': 0.4,
      'sales': 0.3,
      'business': 1.4,
      'support': 1.0
    };

    const complexityFactor = complexityFactors[service.service_category] || 1.0;
    baseCost *= complexityFactor;

    // Adjust for client-specific factors
    if (client.credit_score < 600) {
      baseCost *= 1.1; // Higher risk = higher cost
    }

    if (client.vehicle_value > 100000) {
      baseCost *= 1.15; // Luxury vehicles require specialized handling
    }

    return Math.round(baseCost * 100) / 100;
  }

  async getClientProfile(clientId) {
    try {
      // Try cache first
      const cached = await redis.getRevenueData(clientId);
      if (cached) {
        return cached;
      }

      // Get from database
      const client = await database.query(`
        SELECT 
          c.*,
          COUNT(so.id) as services_count,
          SUM(CASE WHEN so.status = 'completed' THEN so.final_price ELSE 0 END) as total_spent,
          AVG(CASE WHEN so.status = 'completed' THEN so.final_price ELSE NULL END) as avg_order_value
        FROM clients c
        LEFT JOIN service_orders so ON c.id = so.client_id
        WHERE c.id = $1
        GROUP BY c.id
      `, [clientId]);

      if (client.rows.length === 0) {
        return null;
      }

      const profile = {
        ...client.rows[0],
        services_count: parseInt(client.rows[0].services_count) || 0,
        total_spent: parseFloat(client.rows[0].total_spent) || 0,
        avg_order_value: parseFloat(client.rows[0].avg_order_value) || 0
      };

      // Cache for 1 hour
      await redis.cacheRevenueData(clientId, profile, 3600);
      return profile;

    } catch (error) {
      logger.error('Error getting client profile for pricing:', error);
      return null;
    }
  }

  async trackRevenue(orderId, amount, serviceId, clientId) {
    try {
      // Create revenue record
      const revenueRecord = await database.create('revenue_records', {
        client_id: clientId,
        service_id: serviceId,
        order_id: orderId,
        revenue_amount: amount,
        profit_amount: amount * this.profitMarginTarget,
        revenue_date: new Date()
      });

      // Update client lifetime value
      await this.updateClientLifetimeValue(clientId, amount);

      // Log revenue generation
      logger.revenueGenerated(clientId, serviceId, amount, orderId);

      // Update real-time revenue metrics
      await this.updateRevenueMetrics(serviceId, amount);

      return revenueRecord;

    } catch (error) {
      handleRevenueError(error);
    }
  }

  async updateClientLifetimeValue(clientId, additionalRevenue) {
    try {
      const client = await database.findById('clients', clientId);
      if (client) {
        const newLifetimeValue = (client.lifetime_value || 0) + additionalRevenue;
        const newTotalSpent = (client.total_spent || 0) + additionalRevenue;
        
        await database.update('clients', clientId, {
          lifetime_value: newLifetimeValue,
          total_spent: newTotalSpent,
          services_count: (client.services_count || 0) + 1
        });

        // Clear cache to ensure fresh data
        await redis.del(`client_profile:${clientId}`);
        await redis.del(`revenue:${clientId}`);
      }
    } catch (error) {
      logger.error('Error updating client lifetime value:', error);
    }
  }

  async updateRevenueMetrics(serviceId, amount) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Update daily metrics
      await redis.recordMetric(`daily_revenue:${today}`, amount);
      await redis.recordMetric(`service_revenue:${serviceId}:${today}`, amount);
      
      // Update monthly metrics
      const month = today.substring(0, 7);
      await redis.recordMetric(`monthly_revenue:${month}`, amount);
      
      // Update annual metrics
      const year = today.substring(0, 4);
      await redis.recordMetric(`annual_revenue:${year}`, amount);

    } catch (error) {
      logger.error('Error updating revenue metrics:', error);
    }
  }

  async getRevenueAnalytics(timeframe = '30d') {
    try {
      const query = `
        SELECT 
          DATE_TRUNC('day', revenue_date) as date,
          SUM(revenue_amount) as daily_revenue,
          COUNT(*) as transactions,
          AVG(revenue_amount) as avg_transaction
        FROM revenue_records
        WHERE revenue_date >= NOW() - INTERVAL '${timeframe}'
        GROUP BY DATE_TRUNC('day', revenue_date)
        ORDER BY date DESC
      `;

      const dailyData = await database.query(query);

      const serviceQuery = `
        SELECT 
          s.name,
          s.slug,
          s.annual_revenue_target,
          SUM(rr.revenue_amount) as actual_revenue,
          COUNT(rr.id) as transactions,
          AVG(rr.revenue_amount) as avg_revenue
        FROM services s
        LEFT JOIN revenue_records rr ON s.id = rr.service_id
        WHERE rr.revenue_date >= NOW() - INTERVAL '${timeframe}'
        GROUP BY s.id, s.name, s.slug, s.annual_revenue_target
        ORDER BY actual_revenue DESC
      `;

      const serviceData = await database.query(serviceQuery);

      const totalRevenue = dailyData.rows.reduce((sum, row) => sum + parseFloat(row.daily_revenue), 0);
      const totalTransactions = dailyData.rows.reduce((sum, row) => sum + parseInt(row.transactions), 0);

      return {
        timeframe,
        totalRevenue,
        totalTransactions,
        avgTransaction: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
        dailyData: dailyData.rows,
        servicePerformance: serviceData.rows.map(row => ({
          ...row,
          actual_revenue: parseFloat(row.actual_revenue) || 0,
          annual_revenue_target: parseFloat(row.annual_revenue_target) || 0,
          progress: row.annual_revenue_target > 0 ? 
            (parseFloat(row.actual_revenue) / parseFloat(row.annual_revenue_target)) * 100 : 0
        })),
        annualProjection: this.calculateAnnualProjection(totalRevenue, timeframe)
      };

    } catch (error) {
      logger.error('Error getting revenue analytics:', error);
      return {
        totalRevenue: 0,
        totalTransactions: 0,
        avgTransaction: 0,
        dailyData: [],
        servicePerformance: [],
        annualProjection: 0
      };
    }
  }

  calculateAnnualProjection(revenueAmount, timeframe) {
    const days = parseInt(timeframe.replace('d', ''));
    const dailyAverage = revenueAmount / days;
    return dailyAverage * 365;
  }

  async optimizePricing() {
    try {
      logger.info('Starting pricing optimization...');

      // Get service performance data
      const performanceQuery = `
        SELECT 
          s.id,
          s.name,
          s.base_price,
          s.annual_revenue_target,
          COUNT(so.id) as total_orders,
          SUM(CASE WHEN so.status = 'completed' THEN so.final_price ELSE 0 END) as actual_revenue,
          AVG(CASE WHEN so.status = 'completed' THEN so.final_price ELSE NULL END) as avg_price,
          COUNT(CASE WHEN so.status = 'cancelled' THEN 1 END) as cancelled_orders
        FROM services s
        LEFT JOIN service_orders so ON s.id = so.service_id
        WHERE so.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY s.id, s.name, s.base_price, s.annual_revenue_target
      `;

      const results = await database.query(performanceQuery);

      for (const service of results.rows) {
        const cancellationRate = service.total_orders > 0 ? 
          service.cancelled_orders / service.total_orders : 0;
        
        const revenueProgress = service.annual_revenue_target > 0 ? 
          service.actual_revenue / service.annual_revenue_target : 0;

        // Suggest price adjustments
        let priceAdjustment = 1.0;

        // If cancellation rate is high, consider price reduction
        if (cancellationRate > 0.2) {
          priceAdjustment *= 0.95;
        }

        // If revenue is below target, consider price increase
        if (revenueProgress < 0.5) {
          priceAdjustment *= 1.05;
        }

        // If revenue is well above target, consider price increase
        if (revenueProgress > 1.2) {
          priceAdjustment *= 1.1;
        }

        // Apply optimization if significant change needed
        if (Math.abs(priceAdjustment - 1.0) > 0.02) {
          const newPrice = service.base_price * priceAdjustment;
          
          logger.info('Price optimization suggestion', {
            serviceId: service.id,
            serviceName: service.name,
            currentPrice: service.base_price,
            suggestedPrice: newPrice,
            adjustment: priceAdjustment,
            cancellationRate,
            revenueProgress
          });

          // Update base price if within reasonable bounds
          if (priceAdjustment >= 0.8 && priceAdjustment <= 1.3) {
            await database.update('services', service.id, {
              base_price: Math.round(newPrice * 100) / 100
            });
          }
        }
      }

      logger.info('Pricing optimization completed');

    } catch (error) {
      logger.error('Error in pricing optimization:', error);
    }
  }

  async getRevenueProjection() {
    try {
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const dayOfYear = Math.floor((currentDate - new Date(currentYear, 0, 0)) / (1000 * 60 * 60 * 24));

      // Get YTD revenue
      const ytdQuery = `
        SELECT SUM(revenue_amount) as ytd_revenue
        FROM revenue_records
        WHERE EXTRACT(YEAR FROM revenue_date) = $1
      `;
      
      const ytdResult = await database.query(ytdQuery, [currentYear]);
      const ytdRevenue = parseFloat(ytdResult.rows[0].ytd_revenue) || 0;

      // Calculate projection
      const dailyAverage = ytdRevenue / dayOfYear;
      const annualProjection = dailyAverage * 365;
      const targetProgress = (ytdRevenue / this.annualRevenueTarget) * 100;

      return {
        annualTarget: this.annualRevenueTarget,
        ytdRevenue,
        annualProjection,
        targetProgress,
        onTrack: annualProjection >= this.annualRevenueTarget * 0.9,
        dailyAverage,
        remainingTarget: Math.max(0, this.annualRevenueTarget - ytdRevenue),
        daysRemaining: 365 - dayOfYear
      };

    } catch (error) {
      logger.error('Error calculating revenue projection:', error);
      return {
        annualTarget: this.annualRevenueTarget,
        ytdRevenue: 0,
        annualProjection: 0,
        targetProgress: 0,
        onTrack: false,
        dailyAverage: 0,
        remainingTarget: this.annualRevenueTarget,
        daysRemaining: 365
      };
    }
  }
}

module.exports = RevenueOptimizer; 