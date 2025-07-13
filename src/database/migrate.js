const fs = require('fs');
const path = require('path');
const database = require('./connection');
const logger = require('../utils/logger');

class DatabaseMigrator {
  constructor() {
    this.schemaPath = path.join(__dirname, 'schema.sql');
    this.seedPath = path.join(__dirname, 'seed.sql');
  }

  async runMigrations() {
    try {
      logger.info('Starting database migrations...');
      
      // Read and execute schema
      const schema = fs.readFileSync(this.schemaPath, 'utf8');
      await database.query(schema);
      logger.info('Database schema created successfully');
      
      // Read and execute seed data
      if (fs.existsSync(this.seedPath)) {
        const seedData = fs.readFileSync(this.seedPath, 'utf8');
        await database.query(seedData);
        logger.info('Database seeded successfully');
      }
      
      // Insert the 14 revenue-generating services
      await this.seedServices();
      
      // Setup service cascades
      await this.setupServiceCascades();
      
      logger.info('Database migrations completed successfully');
      
    } catch (error) {
      logger.error('Database migration failed:', error);
      throw error;
    }
  }

  async seedServices() {
    logger.info('Seeding 14 revenue-generating services...');
    
    const services = [
      {
        name: 'Credit Analysis & Improvement Plan',
        slug: 'credit-analysis',
        description: 'Comprehensive credit analysis with personalized improvement plan and timeline',
        base_price: 997.00,
        markup_percentage: 0,
        annual_revenue_target: 12800000.00,
        service_category: 'financial'
      },
      {
        name: 'Loan Optimization & Acquisition',
        slug: 'loan-optimization',
        description: 'Professional loan optimization and acquisition services with lender matching',
        base_price: 2500.00,
        markup_percentage: 0,
        annual_revenue_target: 8400000.00,
        service_category: 'financial'
      },
      {
        name: 'Financial Preparation & Lender Matching',
        slug: 'financial-preparation',
        description: 'Complete financial preparation and strategic lender matching services',
        base_price: 1500.00,
        markup_percentage: 0,
        annual_revenue_target: 5400000.00,
        service_category: 'financial'
      },
      {
        name: 'Vehicle Finance Solutions',
        slug: 'vehicle-finance',
        description: 'Specialized vehicle financing solutions with competitive rates',
        base_price: 1200.00,
        markup_percentage: 0,
        annual_revenue_target: 10100000.00,
        service_category: 'financial'
      },
      {
        name: 'Nationwide Vehicle Transport',
        slug: 'vehicle-transport',
        description: 'Professional nationwide vehicle transport with insurance coverage',
        base_price: 1200.00,
        markup_percentage: 0,
        annual_revenue_target: 7200000.00,
        service_category: 'logistics'
      },
      {
        name: 'Parts Acquisition & Sourcing',
        slug: 'parts-sourcing',
        description: 'Professional parts acquisition and sourcing with quality guarantee',
        base_price: 0.00,
        markup_percentage: 25.00,
        annual_revenue_target: 2700000.00,
        service_category: 'parts'
      },
      {
        name: 'Elite Vehicle Purchase Solutions',
        slug: 'vehicle-purchase',
        description: 'Elite vehicle purchase assistance with negotiation and inspection',
        base_price: 0.00,
        markup_percentage: 3.00,
        annual_revenue_target: 3000000.00,
        service_category: 'purchase'
      },
      {
        name: 'Vehicle Consignment Services',
        slug: 'vehicle-consignment',
        description: 'Professional vehicle consignment with marketing and sales support',
        base_price: 0.00,
        markup_percentage: 7.00,
        annual_revenue_target: 2800000.00,
        service_category: 'sales'
      },
      {
        name: 'Vehicle Reconditioning & Diagnostics',
        slug: 'vehicle-reconditioning',
        description: 'Complete vehicle reconditioning and diagnostic services',
        base_price: 4200.00,
        markup_percentage: 0,
        annual_revenue_target: 6800000.00,
        service_category: 'maintenance'
      },
      {
        name: 'DMV Concierge Services',
        slug: 'dmv-concierge',
        description: 'Full-service DMV concierge handling all registration and title needs',
        base_price: 550.00,
        markup_percentage: 0,
        annual_revenue_target: 2500000.00,
        service_category: 'administrative'
      },
      {
        name: 'Legal Consultation & Attorney Network',
        slug: 'legal-consultation',
        description: 'Professional legal consultation with specialized attorney network',
        base_price: 1700.00,
        markup_percentage: 0,
        annual_revenue_target: 1700000.00,
        service_category: 'legal'
      },
      {
        name: 'Business Formation & Launch Support',
        slug: 'business-formation',
        description: 'Complete business formation and launch support services',
        base_price: 2500.00,
        markup_percentage: 0,
        annual_revenue_target: 4000000.00,
        service_category: 'business'
      },
      {
        name: 'Specialized Problem Resolution',
        slug: 'problem-resolution',
        description: 'Specialized problem resolution for complex automotive and financial issues',
        base_price: 3500.00,
        markup_percentage: 0,
        annual_revenue_target: 5900000.00,
        service_category: 'support'
      },
      {
        name: 'Vehicle Inspection Services',
        slug: 'vehicle-inspection',
        description: '11 types of professional vehicle inspections with detailed reports',
        base_price: 775.00,
        markup_percentage: 0,
        annual_revenue_target: 21800000.00,
        service_category: 'inspection'
      }
    ];

    for (const service of services) {
      try {
        const existingService = await database.findOne('services', { slug: service.slug });
        if (!existingService) {
          await database.create('services', service);
          logger.info(`Created service: ${service.name}`);
        } else {
          logger.info(`Service already exists: ${service.name}`);
        }
      } catch (error) {
        logger.error(`Failed to create service ${service.name}:`, error);
      }
    }
    
    logger.info('Services seeding completed');
  }

  async setupServiceCascades() {
    logger.info('Setting up service cascade rules...');
    
    // Get service IDs
    const services = await database.findMany('services');
    const serviceMap = services.reduce((map, service) => {
      map[service.slug] = service.id;
      return map;
    }, {});

    const cascadeRules = [
      // Credit Analysis triggers
      {
        entry_service: 'credit-analysis',
        triggered_service: 'vehicle-finance',
        conversion_rate: 0.84,
        priority: 1,
        conditions: { min_credit_score: 500 }
      },
      {
        entry_service: 'credit-analysis',
        triggered_service: 'vehicle-transport',
        conversion_rate: 0.76,
        priority: 2,
        conditions: { vehicle_purchase_intent: true }
      },
      {
        entry_service: 'credit-analysis',
        triggered_service: 'loan-optimization',
        conversion_rate: 0.68,
        priority: 3,
        conditions: { credit_score_improvement_needed: true }
      },
      
      // Vehicle Purchase triggers
      {
        entry_service: 'vehicle-purchase',
        triggered_service: 'vehicle-finance',
        conversion_rate: 0.92,
        priority: 1,
        conditions: { financing_needed: true }
      },
      {
        entry_service: 'vehicle-purchase',
        triggered_service: 'vehicle-reconditioning',
        conversion_rate: 0.68,
        priority: 2,
        conditions: { vehicle_condition_fair_or_below: true }
      },
      {
        entry_service: 'vehicle-purchase',
        triggered_service: 'vehicle-inspection',
        conversion_rate: 0.85,
        priority: 1,
        conditions: { pre_purchase_inspection: true }
      },
      {
        entry_service: 'vehicle-purchase',
        triggered_service: 'dmv-concierge',
        conversion_rate: 0.78,
        priority: 2,
        conditions: { title_transfer_needed: true }
      },
      
      // Business Formation triggers
      {
        entry_service: 'business-formation',
        triggered_service: 'loan-optimization',
        conversion_rate: 0.71,
        priority: 1,
        conditions: { business_financing_needed: true }
      },
      {
        entry_service: 'business-formation',
        triggered_service: 'legal-consultation',
        conversion_rate: 0.89,
        priority: 1,
        conditions: { legal_structure_complex: true }
      },
      
      // Vehicle Finance triggers
      {
        entry_service: 'vehicle-finance',
        triggered_service: 'vehicle-transport',
        conversion_rate: 0.73,
        priority: 2,
        conditions: { vehicle_location_different: true }
      },
      {
        entry_service: 'vehicle-finance',
        triggered_service: 'vehicle-inspection',
        conversion_rate: 0.81,
        priority: 1,
        conditions: { lender_inspection_required: true }
      },
      
      // Vehicle Inspection triggers
      {
        entry_service: 'vehicle-inspection',
        triggered_service: 'vehicle-reconditioning',
        conversion_rate: 0.64,
        priority: 1,
        conditions: { issues_found: true }
      },
      {
        entry_service: 'vehicle-inspection',
        triggered_service: 'parts-sourcing',
        conversion_rate: 0.72,
        priority: 2,
        conditions: { parts_needed: true }
      },
      
      // Vehicle Reconditioning triggers
      {
        entry_service: 'vehicle-reconditioning',
        triggered_service: 'parts-sourcing',
        conversion_rate: 0.88,
        priority: 1,
        conditions: { parts_replacement_needed: true }
      },
      {
        entry_service: 'vehicle-reconditioning',
        triggered_service: 'vehicle-inspection',
        conversion_rate: 0.76,
        priority: 2,
        conditions: { post_work_inspection: true }
      },
      
      // Problem Resolution triggers
      {
        entry_service: 'problem-resolution',
        triggered_service: 'legal-consultation',
        conversion_rate: 0.82,
        priority: 1,
        conditions: { legal_issue_identified: true }
      },
      {
        entry_service: 'problem-resolution',
        triggered_service: 'credit-analysis',
        conversion_rate: 0.69,
        priority: 2,
        conditions: { credit_related_problem: true }
      }
    ];

    for (const rule of cascadeRules) {
      try {
        const entryServiceId = serviceMap[rule.entry_service];
        const triggeredServiceId = serviceMap[rule.triggered_service];
        
        if (entryServiceId && triggeredServiceId) {
          const existingCascade = await database.findOne('service_cascades', {
            entry_service_id: entryServiceId,
            triggered_service_id: triggeredServiceId
          });
          
          if (!existingCascade) {
            await database.create('service_cascades', {
              entry_service_id: entryServiceId,
              triggered_service_id: triggeredServiceId,
              conversion_rate: rule.conversion_rate,
              priority: rule.priority,
              conditions: JSON.stringify(rule.conditions),
              is_active: true
            });
            logger.info(`Created cascade: ${rule.entry_service} -> ${rule.triggered_service}`);
          }
        }
      } catch (error) {
        logger.error(`Failed to create cascade rule:`, error);
      }
    }
    
    logger.info('Service cascade setup completed');
  }

  async rollback() {
    try {
      logger.info('Rolling back database...');
      
      // Drop all tables in reverse order
      const tables = [
        'audit_logs', 'notifications', 'integration_logs', 'client_journey',
        'revenue_records', 'business_formations', 'legal_consultations',
        'dmv_services', 'vehicle_consignments', 'vehicle_purchases',
        'parts_orders', 'transport_orders', 'vehicle_inspections',
        'loan_applications', 'credit_analyses', 'cascade_triggers',
        'service_cascades', 'service_orders', 'services', 'vehicles',
        'clients', 'users'
      ];
      
      for (const table of tables) {
        await database.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
      
      // Drop enums
      const enums = [
        'user_role', 'client_status', 'service_status', 'payment_status',
        'vehicle_condition', 'inspection_type', 'credit_score_range', 'loan_status'
      ];
      
      for (const enumType of enums) {
        await database.query(`DROP TYPE IF EXISTS ${enumType} CASCADE`);
      }
      
      logger.info('Database rollback completed');
      
    } catch (error) {
      logger.error('Database rollback failed:', error);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const migrator = new DatabaseMigrator();
  const command = process.argv[2];
  
  try {
    await database.initialize();
    
    switch (command) {
      case 'up':
        await migrator.runMigrations();
        break;
      case 'down':
        await migrator.rollback();
        break;
      case 'reset':
        await migrator.rollback();
        await migrator.runMigrations();
        break;
      default:
        await migrator.runMigrations();
    }
    
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = DatabaseMigrator; 