const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Luxury Automotive Ecosystem API',
      version: '1.0.0',
      description: `
        # Luxury Automotive & Financial Services Platform API
        
        A comprehensive enterprise-grade API for managing luxury automotive and financial services with 14 revenue-generating services targeting $284.6M annual revenue.
        
        ## Features
        
        - **14 Revenue-Generating Services**: Credit analysis, loan optimization, vehicle finance, transport, inspections, and more
        - **Intelligent Service Cascade**: 84% conversion rates through automated service recommendations
        - **Dynamic Pricing**: AI-powered pricing optimization based on client profiles and market conditions
        - **Revenue Optimization**: Real-time revenue tracking and profit margin optimization
        - **Enterprise Integrations**: HubSpot CRM, Make.com automation, Slack notifications, JotForm
        - **AI-Powered Processing**: Vehicle condition analysis, credit scoring, and predictive analytics
        
        ## Service Categories
        
        ### Financial Services
        - Credit Analysis & Improvement Plan ($997 base, $12.8M annual target)
        - Loan Optimization & Acquisition ($2,500 base, $8.4M annual target)
        - Financial Preparation & Lender Matching ($1,500 base, $5.4M annual target)
        - Vehicle Finance Solutions ($1,200 base, $10.1M annual target)
        
        ### Automotive Services
        - Vehicle Inspection Services - 11 types ($350-1,200, $21.8M annual target)
        - Vehicle Reconditioning & Diagnostics ($4,200 avg, $6.8M annual target)
        - Nationwide Vehicle Transport ($1,200 avg, $7.2M annual target)
        - Parts Acquisition & Sourcing (25% markup, $2.7M annual target)
        
        ### Premium Services
        - Elite Vehicle Purchase Solutions (3% commission, $3.0M annual target)
        - Vehicle Consignment Services (7% commission, $2.8M annual target)
        - Specialized Problem Resolution ($3,500 avg, $5.9M annual target)
        
        ### Business Services
        - Business Formation & Launch Support ($2,500 base, $4.0M annual target)
        - Legal Consultation & Attorney Network ($1,700 avg, $1.7M annual target)
        - DMV Concierge Services ($350-750, $2.5M annual target)
        
        ## Authentication
        
        This API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:
        
        \`\`\`
        Authorization: Bearer <your-jwt-token>
        \`\`\`
        
        ## Rate Limiting
        
        API requests are rate-limited to 100 requests per 15-minute window per user.
        
        ## Error Handling
        
        All API responses follow a consistent error format:
        
        \`\`\`json
        {
          "success": false,
          "error": "Error message",
          "code": "ERROR_CODE",
          "timestamp": "2024-01-01T00:00:00.000Z"
        }
        \`\`\`
        
        ## Revenue Tracking
        
        All service completions are automatically tracked for revenue optimization and cascade triggering.
      `,
      contact: {
        name: 'Luxury Automotive Ecosystem Support',
        email: 'support@luxuryautomotive.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://api.luxuryautomotive.com' 
          : 'http://localhost:3000',
        description: process.env.NODE_ENV === 'production' 
          ? 'Production server' 
          : 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/login'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique user identifier'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            firstName: {
              type: 'string',
              description: 'User first name'
            },
            lastName: {
              type: 'string',
              description: 'User last name'
            },
            role: {
              type: 'string',
              enum: ['client', 'agent', 'admin', 'super_admin'],
              description: 'User role'
            },
            isVerified: {
              type: 'boolean',
              description: 'Email verification status'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation date'
            }
          }
        },
        Client: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique client identifier'
            },
            businessName: {
              type: 'string',
              description: 'Business name (if applicable)'
            },
            clientType: {
              type: 'string',
              enum: ['individual', 'business', 'dealer'],
              description: 'Type of client'
            },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'suspended', 'premium'],
              description: 'Client status'
            },
            vehicleValue: {
              type: 'number',
              description: 'Estimated vehicle value'
            },
            creditScore: {
              type: 'integer',
              minimum: 300,
              maximum: 850,
              description: 'Credit score'
            },
            annualIncome: {
              type: 'number',
              description: 'Annual income'
            },
            journeyStage: {
              type: 'string',
              enum: ['discovery', 'consideration', 'purchase', 'post_purchase'],
              description: 'Current journey stage'
            },
            lifetimeValue: {
              type: 'number',
              description: 'Client lifetime value'
            },
            totalSpent: {
              type: 'number',
              description: 'Total amount spent'
            },
            servicesCount: {
              type: 'integer',
              description: 'Number of services used'
            }
          }
        },
        Service: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique service identifier'
            },
            name: {
              type: 'string',
              description: 'Service name'
            },
            slug: {
              type: 'string',
              description: 'Service URL slug'
            },
            description: {
              type: 'string',
              description: 'Service description'
            },
            category: {
              type: 'string',
              enum: ['financial', 'automotive', 'premium', 'business'],
              description: 'Service category'
            },
            basePrice: {
              type: 'number',
              description: 'Base service price'
            },
            finalPrice: {
              type: 'number',
              description: 'Final price after dynamic pricing'
            },
            isActive: {
              type: 'boolean',
              description: 'Service availability status'
            },
            annualRevenueTarget: {
              type: 'number',
              description: 'Annual revenue target'
            }
          }
        },
        ServiceOrder: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique order identifier'
            },
            orderNumber: {
              type: 'string',
              description: 'Human-readable order number'
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              description: 'Order status'
            },
            service: {
              $ref: '#/components/schemas/Service'
            },
            client: {
              $ref: '#/components/schemas/Client'
            },
            vehicle: {
              $ref: '#/components/schemas/Vehicle'
            },
            pricing: {
              type: 'object',
              properties: {
                basePrice: {
                  type: 'number',
                  description: 'Base service price'
                },
                finalPrice: {
                  type: 'number',
                  description: 'Final price after adjustments'
                },
                discountAmount: {
                  type: 'number',
                  description: 'Discount amount applied'
                },
                taxAmount: {
                  type: 'number',
                  description: 'Tax amount'
                }
              }
            },
            notes: {
              type: 'string',
              description: 'Order notes'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Order creation date'
            },
            completedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Order completion date'
            }
          }
        },
        Vehicle: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique vehicle identifier'
            },
            vin: {
              type: 'string',
              description: 'Vehicle Identification Number'
            },
            make: {
              type: 'string',
              description: 'Vehicle make'
            },
            model: {
              type: 'string',
              description: 'Vehicle model'
            },
            year: {
              type: 'integer',
              description: 'Vehicle year'
            },
            trim: {
              type: 'string',
              description: 'Vehicle trim level'
            },
            mileage: {
              type: 'integer',
              description: 'Vehicle mileage'
            },
            color: {
              type: 'string',
              description: 'Vehicle color'
            },
            condition: {
              type: 'string',
              enum: ['excellent', 'good', 'fair', 'poor', 'salvage'],
              description: 'Vehicle condition'
            },
            estimatedValue: {
              type: 'number',
              description: 'Estimated vehicle value'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              description: 'Error message'
            },
            code: {
              type: 'string',
              description: 'Error code'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Error timestamp'
            },
            path: {
              type: 'string',
              description: 'API path that caused the error'
            }
          }
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'array',
              items: {}
            },
            pagination: {
              type: 'object',
              properties: {
                page: {
                  type: 'integer',
                  description: 'Current page number'
                },
                limit: {
                  type: 'integer',
                  description: 'Items per page'
                },
                total: {
                  type: 'integer',
                  description: 'Total number of items'
                },
                totalPages: {
                  type: 'integer',
                  description: 'Total number of pages'
                },
                hasNext: {
                  type: 'boolean',
                  description: 'Has next page'
                },
                hasPrevious: {
                  type: 'boolean',
                  description: 'Has previous page'
                }
              }
            }
          }
        }
      },
      responses: {
        BadRequest: {
          description: 'Bad Request',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        Unauthorized: {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        Forbidden: {
          description: 'Forbidden',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        NotFound: {
          description: 'Not Found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        TooManyRequests: {
          description: 'Too Many Requests',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        InternalServerError: {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization endpoints'
      },
      {
        name: 'Services',
        description: 'Core service management and ordering endpoints'
      },
      {
        name: 'Revenue',
        description: 'Revenue tracking and optimization endpoints'
      },
      {
        name: 'Cascade',
        description: 'Service cascade engine endpoints'
      },
      {
        name: 'Clients',
        description: 'Client management endpoints'
      },
      {
        name: 'Vehicles',
        description: 'Vehicle management endpoints'
      },
      {
        name: 'Integrations',
        description: 'Third-party integration endpoints'
      },
      {
        name: 'AI',
        description: 'AI-powered processing endpoints'
      },
      {
        name: 'Dashboard',
        description: 'Dashboard and analytics endpoints'
      }
    ]
  },
  apis: [
    './src/api/*.js',
    './src/server.js'
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;