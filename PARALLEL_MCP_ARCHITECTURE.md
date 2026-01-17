# Parallel MCP Architecture for Production-Ready CAD

## Problem Statement

**Token Limit Bottleneck**: Single Claude calls are limited to 64K output tokens, which restricts geometry detail to ~500-800 vertices. This is insufficient for production-ready mechanical designs.

**Example**: A production V8 engine block requires:
- 8 cylinder bores with cooling jackets: ~600 vertices
- 8 piston assemblies with rings: ~700 vertices
- Crankshaft with journals and counterweights: ~900 vertices
- Valvetrain (cams, valves, springs): ~800 vertices
- Oil system galleries: ~500 vertices
- Cooling system passages: ~500 vertices
- Mounting points and external features: ~400 vertices

**Total Required**: 4,400+ vertices for full production detail
**Single Call Limit**: ~500-800 vertices
**Gap**: 5.5x insufficient detail

## Solution: Parallel Multi-Component Architecture

Break complex designs into parallel subtasks, each with independent Claude calls and full token budget.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    User Request                              │
│        "Create V8 engine block with full detail"            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│          Component Breakdown & Dependency Analysis           │
│  - Detects type (V8 engine, gear, hydraulic system, etc.)   │
│  - Breaks into parallel subtasks with dependencies           │
│  - Creates wave-based execution plan                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Wave 1: Base Components                    │
│     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│     │ Engine Block │  │  Crankshaft  │  │  Oil System  │   │
│     │   Base (800) │  │   (900 vtx)  │  │  (500 vtx)   │   │
│     └──────────────┘  └──────────────┘  └──────────────┘   │
│          Parallel Claude Calls (64K tokens each)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Wave 2: Dependent Components                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Left Cylinder│  │Right Cylinder│  │  Valvetrain  │      │
│  │  Bank (600)  │  │  Bank (600)  │  │   (800 vtx)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│          Parallel Claude Calls (64K tokens each)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Wave 3: Detail Components                   │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│    │ Pistons 1-4  │  │ Pistons 5-8  │  │   Cooling    │    │
│    │   (700 vtx)  │  │   (700 vtx)  │  │  (500 vtx)   │    │
│    └──────────────┘  └──────────────┘  └──────────────┘    │
│          Parallel Claude Calls (64K tokens each)            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            Geometry Assembly & Validation                    │
│  - Combines all component geometries                         │
│  - Adjusts vertex indices (offsets)                          │
│  - Validates interfaces and tolerances                       │
│  - Ensures assembly integrity                                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Production-Ready V8 Engine Block                │
│                    6,000+ vertices                           │
│              Full detail, all components                     │
└─────────────────────────────────────────────────────────────┘
```

## Component Breakdown Template: V8 Engine

### Wave 1: Independent Base Components
**Parallel execution - no dependencies**

1. **Engine Block Base** (800 vertices)
   - Outer casing structure
   - Main bearing caps (5 positions)
   - Structural ribbing
   - Block deck surface
   - Timing chain cavity

2. **Crankshaft Assembly** (900 vertices)
   - 5 main bearing journals (32 vertices each)
   - 8 connecting rod journals (32 vertices each)
   - 4 crank throws with 90° V-angle
   - 8 counterweights
   - Front/rear mounting surfaces

3. **Oil System** (500 vertices)
   - Main oil gallery (12mm diameter)
   - Branch passages to bearings
   - Oil pump cavity
   - Filter mounting boss
   - Pressure sensor port

### Wave 2: Dependent on Base
**Parallel execution - depends on Wave 1**

4. **Left Cylinder Bank** (600 vertices)
   - 4 cylinder bores (88mm diameter)
   - Cooling water jackets (4mm wall)
   - Head bolt holes (16 total)
   - Oil drain passages
   - Deck surface

5. **Right Cylinder Bank** (600 vertices)
   - 4 cylinder bores (88mm diameter)
   - Cooling water jackets (4mm wall)
   - Head bolt holes (16 total)
   - Oil drain passages
   - Deck surface

6. **Valvetrain System** (800 vertices)
   - 2 camshafts with 8 lobes each
   - 16 valves (8 intake + 8 exhaust)
   - 16 valve springs
   - Retainers and keepers
   - Cam gears

### Wave 3: Detail Components
**Parallel execution - depends on Wave 2**

7. **Piston Assemblies 1-4** (700 vertices)
   - 4 pistons with crowns
   - 3 rings per piston (compression + oil)
   - Wrist pins and bosses
   - Skirt profiles

8. **Piston Assemblies 5-8** (700 vertices)
   - 4 pistons with crowns
   - 3 rings per piston
   - Wrist pins and bosses
   - Skirt profiles

9. **Cooling System** (500 vertices)
   - Water pump cavity
   - Thermostat housing
   - Coolant passages
   - Crossover between banks

10. **Mounting & External** (400 vertices)
    - Engine mount brackets (3x)
    - Alternator bracket
    - AC compressor bracket
    - Bellhousing bolt pattern
    - Sensor ports

### Total Capacity
- **Components**: 10 parallel subtasks
- **Total Vertices**: 6,600 vertices (10x single-call limit)
- **Execution Time**: 3-5 minutes (parallel waves)
- **Detail Level**: Production-ready

## Usage

### Enable Parallel MCP Mode

**Environment Variable**:
```bash
export USE_PARALLEL_MCP=true
```

**In serverless.yml**:
```yaml
environment:
  USE_PARALLEL_MCP: 'true'  # Enabled by default
```

**Programmatic**:
```javascript
const result = await mechanicalOrchestrator.generateMechanicalDesign(
  "Create a V8 engine block with 8 cylinder bores, mounting points, and oil galleries",
  {
    useParallelMCP: true  // Override environment variable
  }
);
```

### API Request

```bash
curl -X POST https://api.archdiscv1.com/api/generate/mechanical \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a V8 engine block with 8 cylinder bores, mounting points, and oil galleries",
    "useParallelMCP": true
  }'
```

### Response Structure

```json
{
  "success": true,
  "design": {
    "geometry": {
      "vertices": [ /* 6,600+ vertices */ ],
      "faces": [ /* face definitions */ ],
      "edges": [ /* edge definitions */ ],
      "components": [
        {
          "id": "engine_block_base",
          "name": "Engine Block Base Structure",
          "vertexStart": 0,
          "vertexEnd": 799,
          "vertexCount": 800
        },
        {
          "id": "crankshaft",
          "name": "Crankshaft Assembly",
          "vertexStart": 800,
          "vertexEnd": 1699,
          "vertexCount": 900
        }
        /* ... 8 more components ... */
      ]
    },
    "components": [ /* detailed component metadata */ ],
    "specifications": { /* engineering specs */ },
    "materials": { /* material selections */ },
    "manufacturing": { /* manufacturing methods */ }
  },
  "validation": {
    "passed": true,
    "parallel_mcp": {
      "passed": true,
      "errors": [],
      "warnings": [],
      "metrics": {
        "totalVertices": 6600,
        "targetVertices": 6000,
        "componentCount": 10,
        "expectedComponents": 10
      }
    }
  },
  "metadata": {
    "template": "V8 Engine Block",
    "totalComponents": 10,
    "generationTime": "187.45",
    "parallelWaves": 3,
    "mode": "parallel_mcp",
    "domain": "mechanical_engineering"
  }
}
```

## Technical Implementation

### File Structure

```
backend/services/
├── parallelMCPOrchestrator.js     # Main orchestrator (new)
├── mechanicalDomainOrchestrator.js # Updated with parallel routing
├── strictGeometryEnforcer.js      # Single-call validation
└── bedrockService.js               # Claude API wrapper
```

### Key Classes

#### ParallelMCPOrchestrator

**Main Methods**:
- `generateWithParallelMCP(prompt, options)` - Entry point
- `detectTemplateType(prompt)` - Detects component type
- `buildExecutionPlan(template)` - Creates wave-based plan
- `generateSingleComponent(component)` - Generates one component
- `assembleComponents(results)` - Combines geometries
- `validateAssembly(geometry)` - Validates final result

**Component Templates**:
- `v8_engine_block` - 10 components, 6,600 vertices
- `spur_gear` - 3 components, 1,700 vertices
- More templates can be added for other mechanical types

### Dependency Resolution

Components have explicit dependencies:
```javascript
{
  id: 'left_cylinder_bank',
  dependencies: ['engine_block_base'],  // Must wait for base
  priority: 2
}
```

**Wave-based execution**:
1. Wave 1: All components with `dependencies: []`
2. Wave 2: All components depending only on Wave 1
3. Wave 3: All components depending on Wave 1 or 2
4. Continue until all components generated

### Error Handling

**Component-level retry**:
- If component generation fails, retry once with 20% more tokens
- If still fails, entire generation fails with detailed error

**Fallback to single-call**:
- If parallel MCP fails entirely, falls back to single-call strict enforcement
- Logs warning but continues execution

## Performance Characteristics

### V8 Engine Block Example

**Single-Call Mode** (before):
- Vertices: ~500-800
- Time: 30-60 seconds
- Detail: Insufficient (boxes)
- Token limit: 64K

**Parallel MCP Mode** (after):
- Vertices: ~6,000-6,600
- Time: 180-240 seconds (3-4 minutes)
- Detail: Production-ready
- Token limit: 640K (10 × 64K)

**Improvement**: 10x more detail, 3-4x longer time

### Cost Analysis

**AWS Lambda**:
- Single call: 1 Lambda × 60s = 60 Lambda-seconds
- Parallel MCP: 10 Lambdas × 20s each (parallel) = 60 Lambda-seconds per wave
- 3 waves = 180 Lambda-seconds total
- **Cost increase**: 3x Lambda time

**Claude API**:
- Single call: 1 × 64K output tokens
- Parallel MCP: 10 × 64K output tokens = 640K tokens
- **Cost increase**: 10x Claude API calls

**Value**: Production-ready detail vs unusable simple boxes

## Supported Mechanical Types

### Currently Implemented
- ✅ V8 Engine Block (10 components, 6,600 vertices)
- ✅ Spur Gear (3 components, 1,700 vertices)

### Planned Templates
- ⏳ Hydraulic Cylinder (5 components, 2,500 vertices)
- ⏳ Gearbox Assembly (8 components, 5,000 vertices)
- ⏳ Pump Housing (6 components, 3,500 vertices)
- ⏳ Valve Body (7 components, 4,000 vertices)

### Adding New Templates

Edit `parallelMCPOrchestrator.js`:

```javascript
buildComponentTemplates() {
  return {
    // ... existing templates ...

    new_type: {
      name: 'New Mechanical Type',
      totalComponents: 5,
      components: [
        {
          id: 'component_1',
          name: 'Component 1 Name',
          description: 'What this component includes',
          targetVertices: 800,
          priority: 1,
          dependencies: [],
          prompt: `Generate ONLY component 1...`
        },
        // ... more components ...
      ]
    }
  };
}
```

## Monitoring & Debugging

### Console Logs

**Wave execution**:
```
🚀 === PARALLEL MCP MODE: PRODUCTION-READY GENERATION ===
   Full Request: "Create a V8 engine block..."
   Mode: Multi-component parallel generation
   Token budget: 64K per component (unlimited total)

📋 Component Breakdown: V8 Engine Block
   Total components: 10
   Max parallel calls: 10

📊 Execution Plan:
   Wave 1: 3 parallel calls
      - Engine Block Base Structure (800 vertices)
      - Crankshaft Assembly (900 vertices)
      - Oil System (500 vertices)
   Wave 2: 3 parallel calls
      - Left Cylinder Bank (600 vertices)
      - Right Cylinder Bank (600 vertices)
      - Valvetrain System (800 vertices)
   Wave 3: 4 parallel calls
      - Piston Assemblies 1-4 (700 vertices)
      - Piston Assemblies 5-8 (700 vertices)
      - Cooling System (500 vertices)
      - Mounting & External (400 vertices)

🌊 Wave 1/3: Executing 3 components in parallel...
   🔧 Generating: Engine Block Base Structure...
   🔧 Generating: Crankshaft Assembly...
   🔧 Generating: Oil System...
   ✅ Engine Block Base Structure: 812 vertices
   ✅ Crankshaft Assembly: 923 vertices
   ✅ Oil System: 487 vertices
   ✅ Wave 1 complete: 3 components generated

🌊 Wave 2/3: Executing 3 components in parallel...
   [similar output]

🌊 Wave 3/3: Executing 4 components in parallel...
   [similar output]

⏱️  Total generation time: 187.45s

🔧 Assembling components...
   ✅ Added Engine Block Base Structure: 812 vertices
   ✅ Added Crankshaft Assembly: 923 vertices
   [... continues for all 10 components ...]

✅ Validating assembly...

🎉 === PARALLEL MCP ORCHESTRATION COMPLETE ===
   Total vertices: 6634
   Total faces: 12450
   Components: 10
   Validation: PASSED ✅
```

### Error Messages

**Component generation failure**:
```
❌ Left Cylinder Bank failed: Insufficient vertices: 423 < 480
🔄 Retrying Left Cylinder Bank...
✅ Left Cylinder Bank: 612 vertices
```

**Parallel MCP complete failure**:
```
❌ Parallel MCP generation failed: Circular dependency detected
⚠️  Falling back to single-call mode...
```

## Limitations

1. **AWS Lambda Concurrent Execution Limit**: 10 parallel calls per wave
   - Can be increased by AWS support
   - Current limit sufficient for most mechanical designs

2. **AWS Lambda Timeout**: 900 seconds (15 minutes) maximum
   - Each wave must complete within Lambda timeout
   - Frontend can poll for longer operations

3. **Component Dependencies**: Must form directed acyclic graph (DAG)
   - No circular dependencies allowed
   - System validates and errors if circular dependencies detected

4. **Template-based**: Currently supports predefined templates
   - V8 engine, spur gear implemented
   - More templates can be added manually
   - Future: AI-powered automatic component breakdown

## Future Enhancements

### Phase 1 (Current)
- ✅ Parallel MCP orchestration
- ✅ Wave-based dependency resolution
- ✅ V8 engine + spur gear templates
- ✅ Geometry assembly and validation

### Phase 2 (Planned)
- ⏳ AI-powered automatic component breakdown (no templates needed)
- ⏳ Component caching (reuse common components)
- ⏳ Dynamic complexity detection (auto-decide single vs parallel)
- ⏳ Assembly constraint validation (tolerances, fits)

### Phase 3 (Future)
- ⏳ Multi-material component support
- ⏳ Motion simulation between components
- ⏳ FEA (Finite Element Analysis) integration
- ⏳ Manufacturing cost estimation per component

## Conclusion

Parallel MCP architecture solves the fundamental token limit bottleneck by:
1. Breaking complex designs into manageable subtasks
2. Executing subtasks in parallel with full token budgets
3. Assembling components into production-ready designs

**Result**: 10x more detail, production-ready mechanical CAD with 6,000+ vertices for complex assemblies.
