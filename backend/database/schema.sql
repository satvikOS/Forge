-- ====================================================================
-- ARCHDISCV1 - COMPLETE PLM DATABASE SCHEMA
-- Production-Grade Engineering Project Database
-- ====================================================================

-- Extension for UUID support
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ====================================================================
-- TABLE: projects
-- Stores top-level engineering projects with complexity classification
-- ====================================================================
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Complexity Classification
    complexity_tier VARCHAR(50) NOT NULL CHECK (complexity_tier IN ('bachelors', 'masters', 'phd', 'professional')),
    complexity_score INTEGER CHECK (complexity_score >= 0 AND complexity_score <= 100),

    -- Engineering Phase Tracking
    current_phase VARCHAR(50) NOT NULL DEFAULT 'concept' CHECK (current_phase IN (
        'concept',              -- Phase 1: Product requirements, systems architecture
        'design',               -- Phase 2: CAD, FEA, CFD validation
        'detailed_engineering', -- Phase 3: GD&T, DFM, mechatronics
        'manufacturing',        -- Phase 4: Tooling, procurement, QA/QC
        'post_production'       -- Phase 5: Service, compliance
    )),

    -- Metadata
    user_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'archived')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,

    -- Performance Metrics
    total_generation_time_seconds INTEGER,
    ai_iterations_count INTEGER DEFAULT 0,
    validation_passes INTEGER DEFAULT 0,
    validation_failures INTEGER DEFAULT 0
);

CREATE INDEX idx_projects_complexity ON projects(complexity_tier);
CREATE INDEX idx_projects_phase ON projects(current_phase);
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_projects_created ON projects(created_at DESC);

-- ====================================================================
-- TABLE: design_models
-- Stores 3D geometry, BOM, and engineering specifications
-- ====================================================================
CREATE TABLE design_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Model Identification
    model_name VARCHAR(255) NOT NULL,
    model_type VARCHAR(50) NOT NULL CHECK (model_type IN ('part', 'assembly', 'drawing')),
    version INTEGER NOT NULL DEFAULT 1,

    -- 3D Geometry (JSON storage for vertices/faces)
    geometry JSONB NOT NULL,
    vertex_count INTEGER NOT NULL,
    face_count INTEGER NOT NULL,

    -- Engineering Specifications
    materials JSONB,  -- [{component, material, properties, justification}]
    dimensions JSONB, -- {overall: {length, width, height}, features: [...]}
    tolerances JSONB, -- {linear: {...}, angular: {...}, gdt: [...]}

    -- Manufacturing Data
    manufacturing_process VARCHAR(255),
    manufacturing_steps JSONB,
    tooling_requirements JSONB,
    estimated_cost_usd DECIMAL(10, 2),

    -- Validation Results
    validation_results JSONB, -- {fea: {...}, cfd: {...}, thermal: {...}, structural: {...}}
    production_ready BOOLEAN DEFAULT FALSE,
    quality_score INTEGER CHECK (quality_score >= 0 AND quality_score <= 100),

    -- File References
    cad_file_url TEXT,
    step_file_url TEXT,
    drawing_pdf_url TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by_ai_model VARCHAR(100),
    generation_time_seconds INTEGER,

    UNIQUE(project_id, model_name, version)
);

CREATE INDEX idx_models_project ON design_models(project_id);
CREATE INDEX idx_models_complexity ON design_models(vertex_count DESC);
CREATE INDEX idx_models_production_ready ON design_models(production_ready);

-- ====================================================================
-- TABLE: ai_generation_logs
-- Detailed logging of AI generation process for learning
-- ====================================================================
CREATE TABLE ai_generation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model_id UUID REFERENCES design_models(id) ON DELETE SET NULL,

    -- AI Execution Details
    ai_model VARCHAR(100) NOT NULL, -- e.g., 'claude-sonnet-4.5'
    orchestration_stage VARCHAR(100) NOT NULL, -- 'concept', 'cad_design', 'fea_validation', etc.

    -- Prompt Engineering
    prompt_template_version VARCHAR(50),
    prompt_tokens_input INTEGER,
    prompt_tokens_output INTEGER,
    prompt_full_text TEXT, -- Store for learning

    -- Response Data
    response_raw TEXT,
    response_parsed JSONB,
    response_valid BOOLEAN,
    response_error TEXT,

    -- Performance Metrics
    execution_time_seconds DECIMAL(10, 3),
    retry_count INTEGER DEFAULT 0,

    -- Quality Assessment
    geometry_validation_passed BOOLEAN,
    complexity_requirement_met BOOLEAN,
    vertex_count_generated INTEGER,
    vertex_count_required INTEGER,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_logs_project ON ai_generation_logs(project_id);
CREATE INDEX idx_ai_logs_model ON ai_generation_logs(model_id);
CREATE INDEX idx_ai_logs_stage ON ai_generation_logs(orchestration_stage);
CREATE INDEX idx_ai_logs_valid ON ai_generation_logs(response_valid);
CREATE INDEX idx_ai_logs_created ON ai_generation_logs(created_at DESC);

-- ====================================================================
-- TABLE: error_patterns
-- Machine learning dataset for error detection and prevention
-- ====================================================================
CREATE TABLE error_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Error Classification
    error_type VARCHAR(100) NOT NULL, -- 'insufficient_geometry', 'invalid_json', 'timeout', etc.
    error_category VARCHAR(50) NOT NULL CHECK (error_category IN (
        'geometry',
        'parsing',
        'validation',
        'simulation',
        'timeout',
        'resource_limit'
    )),

    -- Context
    complexity_tier VARCHAR(50),
    orchestration_stage VARCHAR(100),
    prompt_pattern TEXT, -- Regex or keywords that triggered error

    -- Error Details
    error_message TEXT NOT NULL,
    error_frequency INTEGER DEFAULT 1,
    first_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Resolution
    resolution_strategy TEXT,
    resolution_applied BOOLEAN DEFAULT FALSE,
    resolution_success_rate DECIMAL(5, 2), -- Percentage

    -- Learning Metadata
    auto_detected BOOLEAN DEFAULT TRUE,
    manually_reviewed BOOLEAN DEFAULT FALSE,
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX idx_errors_type ON error_patterns(error_type);
CREATE INDEX idx_errors_category ON error_patterns(error_category);
CREATE INDEX idx_errors_frequency ON error_patterns(error_frequency DESC);
CREATE INDEX idx_errors_last ON error_patterns(last_occurrence DESC);

-- ====================================================================
-- TABLE: simulation_results
-- FEA, CFD, Thermal, Structural analysis results
-- ====================================================================
CREATE TABLE simulation_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES design_models(id) ON DELETE CASCADE,

    -- Simulation Type
    simulation_type VARCHAR(50) NOT NULL CHECK (simulation_type IN (
        'fea_structural',
        'fea_thermal',
        'cfd_external',
        'cfd_internal',
        'modal_analysis',
        'fatigue_analysis',
        'thermal_stress',
        'multibody_dynamics'
    )),

    -- Simulation Tool
    solver_software VARCHAR(100), -- 'ANSYS', 'ABAQUS', 'CONVERGE', 'OpenFOAM', etc.
    solver_version VARCHAR(50),

    -- Mesh Data
    mesh_element_count INTEGER,
    mesh_quality_score DECIMAL(5, 2),
    mesh_type VARCHAR(50), -- 'tetrahedral', 'hexahedral', 'hybrid'

    -- Results (JSON storage for flexibility)
    results JSONB NOT NULL, -- {max_stress, min_safety_factor, temperatures, velocities, etc.}

    -- Pass/Fail Criteria
    passed BOOLEAN NOT NULL,
    safety_factor DECIMAL(10, 3),
    max_stress_mpa DECIMAL(10, 2),
    max_temperature_c DECIMAL(10, 2),
    max_displacement_mm DECIMAL(10, 4),

    -- Performance
    computation_time_seconds INTEGER,
    convergence_achieved BOOLEAN,
    iterations_count INTEGER,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    result_file_url TEXT
);

CREATE INDEX idx_sim_model ON simulation_results(model_id);
CREATE INDEX idx_sim_type ON simulation_results(simulation_type);
CREATE INDEX idx_sim_passed ON simulation_results(passed);

-- ====================================================================
-- TABLE: bill_of_materials (BOM)
-- Hierarchical BOM with sourcing and cost data
-- ====================================================================
CREATE TABLE bill_of_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_item_id UUID REFERENCES bill_of_materials(id) ON DELETE CASCADE,

    -- Item Details
    part_number VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_of_measure VARCHAR(20) DEFAULT 'ea',

    -- Classification
    item_type VARCHAR(50) CHECK (item_type IN ('manufactured', 'purchased', 'standard_part')),
    category VARCHAR(100), -- 'fastener', 'bearing', 'custom_machined', etc.

    -- Material Specification
    material_specification VARCHAR(255),
    material_grade VARCHAR(100),

    -- Manufacturing
    manufacturing_process VARCHAR(255),
    manufacturing_lead_time_days INTEGER,

    -- Procurement
    supplier_name VARCHAR(255),
    supplier_part_number VARCHAR(100),
    unit_cost_usd DECIMAL(10, 4),
    minimum_order_quantity INTEGER,

    -- Standards Compliance
    standards_compliance JSONB, -- ['ISO 9001', 'ASME Y14.5', etc.]

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(project_id, part_number)
);

CREATE INDEX idx_bom_project ON bill_of_materials(project_id);
CREATE INDEX idx_bom_parent ON bill_of_materials(parent_item_id);
CREATE INDEX idx_bom_type ON bill_of_materials(item_type);

-- ====================================================================
-- TABLE: knowledge_base
-- Stores learned patterns, successful designs, and best practices
-- ====================================================================
CREATE TABLE knowledge_base (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Knowledge Type
    knowledge_type VARCHAR(50) NOT NULL CHECK (knowledge_type IN (
        'design_pattern',
        'material_selection',
        'manufacturing_process',
        'optimization_technique',
        'error_resolution',
        'validation_criteria'
    )),

    -- Context
    complexity_tier VARCHAR(50),
    engineering_domain VARCHAR(100), -- 'automotive', 'aerospace', 'consumer_products', etc.

    -- Content
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    detailed_explanation TEXT,
    mathematical_model TEXT, -- LaTeX or plaintext formulas

    -- Evidence (References to successful applications)
    example_project_ids UUID[],
    success_rate DECIMAL(5, 2),
    application_count INTEGER DEFAULT 0,

    -- Metadata
    confidence_score DECIMAL(5, 2) CHECK (confidence_score >= 0 AND confidence_score <= 100),
    last_validated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100) DEFAULT 'system'
);

CREATE INDEX idx_kb_type ON knowledge_base(knowledge_type);
CREATE INDEX idx_kb_tier ON knowledge_base(complexity_tier);
CREATE INDEX idx_kb_confidence ON knowledge_base(confidence_score DESC);

-- ====================================================================
-- TABLE: phase_workflows
-- Tracks the 5-phase engineering workflow execution
-- ====================================================================
CREATE TABLE phase_workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Phase Information
    phase_number INTEGER NOT NULL CHECK (phase_number >= 1 AND phase_number <= 5),
    phase_name VARCHAR(100) NOT NULL,

    -- Execution Details
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'in_progress' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),

    -- AI Orchestration
    ai_tasks JSONB, -- [{task: 'systems_architecture', status: 'completed', result: {...}}]
    human_reviews JSONB, -- [{reviewer: 'stress_lead', approved: true, comments: '...'}]

    -- Deliverables
    deliverables JSONB, -- [{name: 'PRD', url: '...', approved: true}]

    -- Gate Criteria
    gate_criteria_met BOOLEAN DEFAULT FALSE,
    blocking_issues TEXT,

    -- Metadata
    duration_seconds INTEGER,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX idx_workflow_project ON phase_workflows(project_id);
CREATE INDEX idx_workflow_phase ON phase_workflows(phase_number);
CREATE INDEX idx_workflow_status ON phase_workflows(status);

-- ====================================================================
-- MATERIALIZED VIEW: project_statistics
-- Aggregated statistics for learning and optimization
-- ====================================================================
CREATE MATERIALIZED VIEW project_statistics AS
SELECT
    p.complexity_tier,
    COUNT(*) as total_projects,
    AVG(p.total_generation_time_seconds) as avg_generation_time,
    AVG(p.ai_iterations_count) as avg_ai_iterations,
    AVG(dm.vertex_count) as avg_vertex_count,
    AVG(dm.quality_score) as avg_quality_score,
    SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) as successful_projects,
    SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed_projects
FROM projects p
LEFT JOIN design_models dm ON p.id = dm.project_id
GROUP BY p.complexity_tier;

CREATE INDEX idx_stats_tier ON project_statistics(complexity_tier);

-- ====================================================================
-- FUNCTIONS: Automatic timestamp updates
-- ====================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ====================================================================
-- FUNCTIONS: Error pattern learning
-- ====================================================================
CREATE OR REPLACE FUNCTION record_error_pattern(
    p_error_type VARCHAR,
    p_error_category VARCHAR,
    p_error_message TEXT,
    p_complexity_tier VARCHAR DEFAULT NULL,
    p_orchestration_stage VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_pattern_id UUID;
    v_existing_id UUID;
BEGIN
    -- Check if pattern already exists
    SELECT id INTO v_existing_id
    FROM error_patterns
    WHERE error_type = p_error_type
      AND error_category = p_error_category
      AND error_message = p_error_message;

    IF v_existing_id IS NOT NULL THEN
        -- Update frequency and last occurrence
        UPDATE error_patterns
        SET error_frequency = error_frequency + 1,
            last_occurrence = CURRENT_TIMESTAMP
        WHERE id = v_existing_id;

        RETURN v_existing_id;
    ELSE
        -- Insert new pattern
        INSERT INTO error_patterns (
            error_type,
            error_category,
            error_message,
            complexity_tier,
            orchestration_stage,
            severity
        ) VALUES (
            p_error_type,
            p_error_category,
            p_error_message,
            p_complexity_tier,
            p_orchestration_stage,
            'medium' -- Default severity
        )
        RETURNING id INTO v_pattern_id;

        RETURN v_pattern_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ====================================================================
-- FUNCTIONS: Knowledge extraction from successful projects
-- ====================================================================
CREATE OR REPLACE FUNCTION extract_successful_pattern(
    p_project_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_project RECORD;
    v_model RECORD;
BEGIN
    -- Get project details
    SELECT * INTO v_project FROM projects WHERE id = p_project_id AND status = 'completed';

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Extract geometry patterns for this complexity tier
    FOR v_model IN
        SELECT * FROM design_models WHERE project_id = p_project_id AND production_ready = TRUE
    LOOP
        INSERT INTO knowledge_base (
            knowledge_type,
            complexity_tier,
            title,
            description,
            mathematical_model,
            example_project_ids,
            confidence_score
        ) VALUES (
            'design_pattern',
            v_project.complexity_tier,
            'Successful ' || v_model.model_type || ' pattern',
            format('Vertex count: %s, Quality score: %s', v_model.vertex_count, v_model.quality_score),
            v_model.geometry::TEXT,
            ARRAY[p_project_id],
            v_model.quality_score
        )
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ====================================================================
-- SAMPLE DATA: Complexity tier reference examples
-- ====================================================================
COMMENT ON TABLE projects IS 'Top-level engineering projects with complexity classification:
- bachelors: Prototyping, mechatronics basics (e.g., stair-climbing trolley)
- masters: Optimization, FEA/CFD, control systems (e.g., active suspension)
- phd: Novel materials, micro-systems, cutting-edge physics (e.g., flapping wing MAV)
- professional: Tesla/SpaceX/ASML level complexity (e.g., rocket turbopump, EUV wafer stage)';

COMMENT ON TABLE design_models IS 'Stores 3D geometry and engineering specs. Geometry stored as JSONB with vertices/faces arrays.';

COMMENT ON TABLE ai_generation_logs IS 'Complete audit trail of AI generation process for learning and optimization.';

COMMENT ON TABLE error_patterns IS 'Machine learning dataset - system learns from failures and prevents repetition.';

COMMENT ON TABLE simulation_results IS 'FEA, CFD, thermal, structural analysis results for validation.';

COMMENT ON TABLE knowledge_base IS 'Learned patterns from successful projects - fed back into AI prompts for continuous improvement.';
