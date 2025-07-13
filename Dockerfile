# Multi-stage Dockerfile for Luxury Automotive Ecosystem
# Production-ready with security best practices and optimized builds

# Development stage
FROM node:18-alpine AS development

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl \
    git

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=development

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Development command
CMD ["npm", "run", "dev"]

# Build stage
FROM node:18-alpine AS build

# Set working directory
WORKDIR /app

# Install system dependencies for building
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs uploads models

# Set permissions
RUN chown -R node:node /app

# Production stage
FROM node:18-alpine AS production

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Create app directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    curl \
    dumb-init \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built application from build stage
COPY --from=build --chown=nextjs:nodejs /app/src ./src
COPY --from=build --chown=nextjs:nodejs /app/logs ./logs
COPY --from=build --chown=nextjs:nodejs /app/uploads ./uploads
COPY --from=build --chown=nextjs:nodejs /app/models ./models

# Create non-root user
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]

# Testing stage
FROM build AS test

# Set environment for testing
ENV NODE_ENV=test

# Install test dependencies
RUN npm ci

# Run tests
CMD ["npm", "test"]

# Security scanning stage
FROM build AS security

# Install security scanning tools
RUN npm install -g npm-audit-resolver

# Run security audit
RUN npm audit --audit-level moderate

# Lint and format check
RUN npm run lint || true

# Final production stage with security hardening
FROM node:18-alpine AS final

# Security: Update packages
RUN apk update && apk upgrade

# Security: Install security updates
RUN apk add --no-cache \
    curl \
    dumb-init \
    tini

# Create non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S luxuryauto -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production \
    && npm cache clean --force \
    && rm -rf ~/.npm

# Copy application files
COPY --from=build --chown=luxuryauto:nodejs /app/src ./src
COPY --from=build --chown=luxuryauto:nodejs /app/env.example ./
COPY --from=build --chown=luxuryauto:nodejs /app/README.md ./

# Create necessary directories with proper permissions
RUN mkdir -p logs uploads models \
    && chown -R luxuryauto:nodejs logs uploads models \
    && chmod 755 logs uploads models

# Security: Remove unnecessary packages
RUN apk del --purge \
    && rm -rf /var/cache/apk/* \
    && rm -rf /tmp/*

# Switch to non-root user
USER luxuryauto

# Set security labels
LABEL \
    org.opencontainers.image.title="Luxury Automotive Ecosystem" \
    org.opencontainers.image.description="Enterprise-grade luxury automotive and financial services platform" \
    org.opencontainers.image.version="1.0.0" \
    org.opencontainers.image.vendor="Luxury Automotive Ecosystem" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.source="https://github.com/luxury-automotive/ecosystem" \
    security.scan.enabled="true"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Use tini for proper signal handling
ENTRYPOINT ["tini", "--"]

# Start the application
CMD ["node", "src/server.js"] 