-- Luxury Automotive Ecosystem Database Schema
-- 14 Revenue-Generating Services Platform

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Enums
CREATE TYPE user_role AS ENUM ('client', 'agent', 'admin', 'super_admin');
CREATE TYPE client_status AS ENUM ('active', 'inactive', 'suspended', 'premium');
CREATE TYPE service_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled', 'failed');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'partial');
CREATE TYPE vehicle_condition AS ENUM ('excellent', 'good', 'fair', 'poor', 'salvage');
CREATE TYPE inspection_type AS ENUM ('pre_purchase', 'insurance', 'warranty', 'appraisal', 'accident', 'maintenance', 'emissions', 'safety', 'auction', 'export', 'custom');
CREATE TYPE credit_score_range AS ENUM ('excellent', 'good', 'fair', 'poor', 'bad');
CREATE TYPE loan_status AS ENUM ('pending', 'approved', 'declined', 'funded', 'closed');

-- Users table (authentication and roles)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'client',
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Clients table (customer management)
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    business_name VARCHAR(255),
    client_type VARCHAR(50) DEFAULT 'individual', -- individual, business, dealer
    status client_status DEFAULT 'active',
    vehicle_value DECIMAL(12,2),
    credit_score INTEGER,
    credit_score_range credit_score_range,
    annual_income DECIMAL(12,2),
    journey_stage VARCHAR(50) DEFAULT 'discovery', -- discovery, consideration, purchase, post_purchase
    lifetime_value DECIMAL(12,2) DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0,
    services_count INTEGER DEFAULT 0,
    referral_source VARCHAR(100),
    hubspot_contact_id VARCHAR(50),
    notes TEXT,
    tags TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Vehicles table
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    vin VARCHAR(17) UNIQUE,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INTEGER NOT NULL,
    trim VARCHAR(50),
    mileage INTEGER,
    color VARCHAR(30),
    condition vehicle_condition,
    estimated_value DECIMAL(10,2),
    purchase_price DECIMAL(10,2),
    current_location VARCHAR(100),
    images TEXT[],
    documents TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Services table (14 revenue-generating services)
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL,
    markup_percentage DECIMAL(5,2) DEFAULT 0,
    annual_revenue_target DECIMAL(12,2),
    is_active BOOLEAN DEFAULT true,
    service_category VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Service orders table
CREATE TABLE service_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    vehicle_id UUID REFERENCES vehicles(id),
    order_number VARCHAR(20) UNIQUE NOT NULL,
    status service_status DEFAULT 'pending',
    base_price DECIMAL(10,2) NOT NULL,
    final_price DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    payment_status payment_status DEFAULT 'pending',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    cancellation_reason TEXT,
    assigned_to UUID REFERENCES users(id),
    priority INTEGER DEFAULT 1,
    estimated_completion TIMESTAMP,
    service_data JSONB,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Service cascades table (84% conversion tracking)
CREATE TABLE service_cascades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_service_id UUID REFERENCES services(id),
    triggered_service_id UUID REFERENCES services(id),
    conversion_rate DECIMAL(5,4) NOT NULL,
    priority INTEGER DEFAULT 1,
    conditions JSONB, -- JSON conditions for triggering
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Cascade triggers table (tracking actual cascades)
CREATE TABLE cascade_triggers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    entry_order_id UUID REFERENCES service_orders(id),
    triggered_order_id UUID REFERENCES service_orders(id),
    cascade_id UUID REFERENCES service_cascades(id),
    triggered_at TIMESTAMP DEFAULT NOW(),
    converted BOOLEAN DEFAULT false,
    converted_at TIMESTAMP,
    revenue_generated DECIMAL(10,2) DEFAULT 0
);

-- Credit analysis table
CREATE TABLE credit_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    order_id UUID REFERENCES service_orders(id),
    current_score INTEGER,
    target_score INTEGER,
    improvement_plan JSONB,
    recommendations TEXT[],
    timeline_months INTEGER,
    estimated_improvement INTEGER,
    bureau_data JSONB,
    analysis_date TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Loan applications table
CREATE TABLE loan_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id),
    order_id UUID REFERENCES service_orders(id),
    loan_amount DECIMAL(10,2) NOT NULL,
    down_payment DECIMAL(10,2),
    term_months INTEGER,
    interest_rate DECIMAL(5,4),
    monthly_payment DECIMAL(8,2),
    lender_name VARCHAR(100),
    status loan_status DEFAULT 'pending',
    application_data JSONB,
    approval_conditions TEXT[],
    declined_reason TEXT,
    funded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Vehicle inspections table
CREATE TABLE vehicle_inspections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    order_id UUID REFERENCES service_orders(id),
    inspection_type inspection_type NOT NULL,
    inspector_name VARCHAR(100),
    inspection_date TIMESTAMP,
    location VARCHAR(200),
    overall_condition vehicle_condition,
    mileage_verified INTEGER,
    issues_found TEXT[],
    recommendations TEXT[],
    estimated_repair_cost DECIMAL(10,2),
    photos TEXT[],
    report_url VARCHAR(500),
    certificate_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Transport orders table
CREATE TABLE transport_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id),
    order_id UUID REFERENCES service_orders(id),
    pickup_location VARCHAR(200) NOT NULL,
    delivery_location VARCHAR(200) NOT NULL,
    pickup_date TIMESTAMP,
    delivery_date TIMESTAMP,
    estimated_delivery TIMESTAMP,
    transport_type VARCHAR(50), -- open, enclosed, expedited
    carrier_name VARCHAR(100),
    carrier_contact VARCHAR(100),
    tracking_number VARCHAR(50),
    insurance_coverage DECIMAL(10,2),
    status VARCHAR(30) DEFAULT 'scheduled',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Parts orders table
CREATE TABLE parts_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id),
    order_id UUID REFERENCES service_orders(id),
    part_number VARCHAR(100),
    part_name VARCHAR(200) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost DECIMAL(8,2) NOT NULL,
    markup_percentage DECIMAL(5,2) DEFAULT 25,
    selling_price DECIMAL(8,2) NOT NULL,
    supplier_name VARCHAR(100),
    supplier_contact VARCHAR(100),
    estimated_delivery TIMESTAMP,
    status VARCHAR(30) DEFAULT 'ordered',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Vehicle purchases table
CREATE TABLE vehicle_purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    order_id UUID REFERENCES service_orders(id),
    vehicle_details JSONB NOT NULL,
    purchase_price DECIMAL(12,2) NOT NULL,
    commission_rate DECIMAL(5,4) DEFAULT 0.03,
    commission_amount DECIMAL(10,2),
    seller_info JSONB,
    purchase_date TIMESTAMP,
    financing_arranged BOOLEAN DEFAULT false,
    status VARCHAR(30) DEFAULT 'searching',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Vehicle consignments table
CREATE TABLE vehicle_consignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    order_id UUID REFERENCES service_orders(id),
    asking_price DECIMAL(10,2) NOT NULL,
    minimum_price DECIMAL(10,2),
    commission_rate DECIMAL(5,4) DEFAULT 0.07,
    listing_fee DECIMAL(8,2) DEFAULT 0,
    marketing_package VARCHAR(50),
    listing_platforms TEXT[],
    sold_price DECIMAL(10,2),
    sold_date TIMESTAMP,
    commission_earned DECIMAL(10,2),
    status VARCHAR(30) DEFAULT 'listed',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- DMV services table
CREATE TABLE dmv_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id),
    order_id UUID REFERENCES service_orders(id),
    service_type VARCHAR(50) NOT NULL, -- registration, title, plates, etc.
    state VARCHAR(2) NOT NULL,
    documents_required TEXT[],
    documents_provided TEXT[],
    appointment_date TIMESTAMP,
    completion_date TIMESTAMP,
    reference_number VARCHAR(50),
    fees_paid DECIMAL(8,2),
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Legal consultations table
CREATE TABLE legal_consultations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    order_id UUID REFERENCES service_orders(id),
    consultation_type VARCHAR(50) NOT NULL,
    attorney_name VARCHAR(100),
    attorney_contact VARCHAR(100),
    consultation_date TIMESTAMP,
    duration_minutes INTEGER,
    case_details TEXT,
    recommendations TEXT[],
    follow_up_required BOOLEAN DEFAULT false,
    hourly_rate DECIMAL(8,2),
    total_cost DECIMAL(10,2),
    status VARCHAR(30) DEFAULT 'scheduled',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Business formations table
CREATE TABLE business_formations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    order_id UUID REFERENCES service_orders(id),
    business_type VARCHAR(50) NOT NULL, -- LLC, Corp, Partnership, etc.
    business_name VARCHAR(200) NOT NULL,
    state VARCHAR(2) NOT NULL,
    ein VARCHAR(20),
    formation_date TIMESTAMP,
    documents_filed TEXT[],
    annual_requirements TEXT[],
    compliance_calendar JSONB,
    status VARCHAR(30) DEFAULT 'filing',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Revenue tracking table
CREATE TABLE revenue_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    order_id UUID REFERENCES service_orders(id),
    revenue_amount DECIMAL(10,2) NOT NULL,
    cost_amount DECIMAL(10,2) DEFAULT 0,
    profit_amount DECIMAL(10,2) NOT NULL,
    revenue_date DATE NOT NULL,
    payment_method VARCHAR(50),
    stripe_payment_id VARCHAR(100),
    commission_paid DECIMAL(8,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Client journey tracking
CREATE TABLE client_journey (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL,
    previous_stage VARCHAR(50),
    stage_entered_at TIMESTAMP DEFAULT NOW(),
    stage_duration INTEGER, -- minutes
    touchpoints JSONB,
    conversion_probability DECIMAL(5,4),
    next_recommended_action VARCHAR(200),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Integration logs table
CREATE TABLE integration_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_type VARCHAR(50) NOT NULL, -- hubspot, make, slack, jotform
    action VARCHAR(100) NOT NULL,
    client_id UUID REFERENCES clients(id),
    order_id UUID REFERENCES service_orders(id),
    request_data JSONB,
    response_data JSONB,
    status VARCHAR(20) NOT NULL, -- success, error, pending
    error_message TEXT,
    processed_at TIMESTAMP DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(50) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance optimization
CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_credit_score ON clients(credit_score);
CREATE INDEX idx_clients_journey_stage ON clients(journey_stage);
CREATE INDEX idx_clients_created_at ON clients(created_at);

CREATE INDEX idx_vehicles_client_id ON vehicles(client_id);
CREATE INDEX idx_vehicles_vin ON vehicles(vin);
CREATE INDEX idx_vehicles_make_model ON vehicles(make, model);

CREATE INDEX idx_service_orders_client_id ON service_orders(client_id);
CREATE INDEX idx_service_orders_service_id ON service_orders(service_id);
CREATE INDEX idx_service_orders_status ON service_orders(status);
CREATE INDEX idx_service_orders_created_at ON service_orders(created_at);
CREATE INDEX idx_service_orders_completed_at ON service_orders(completed_at);

CREATE INDEX idx_cascade_triggers_client_id ON cascade_triggers(client_id);
CREATE INDEX idx_cascade_triggers_entry_order ON cascade_triggers(entry_order_id);
CREATE INDEX idx_cascade_triggers_triggered_at ON cascade_triggers(triggered_at);

CREATE INDEX idx_revenue_records_client_id ON revenue_records(client_id);
CREATE INDEX idx_revenue_records_service_id ON revenue_records(service_id);
CREATE INDEX idx_revenue_records_revenue_date ON revenue_records(revenue_date);

CREATE INDEX idx_client_journey_client_id ON client_journey(client_id);
CREATE INDEX idx_client_journey_stage ON client_journey(stage);
CREATE INDEX idx_client_journey_entered_at ON client_journey(stage_entered_at);

-- Full-text search indexes
CREATE INDEX idx_clients_search ON clients USING gin(to_tsvector('english', 
    coalesce(business_name, '') || ' ' || coalesce(notes, '')));
CREATE INDEX idx_vehicles_search ON vehicles USING gin(to_tsvector('english', 
    make || ' ' || model || ' ' || coalesce(vin, '')));

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_service_orders_updated_at BEFORE UPDATE ON service_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 