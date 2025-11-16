# 3D Design Generation Architecture

## Overview
This document describes the complete architecture of the 3D design generation and display pipeline in ArchDisc.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Three.js)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │BottomPrompt  │───→│   App.jsx    │───→│AdvancedWork  │      │
│  │    Bar       │    │              │    │   bench      │      │
│  └──────────────┘    │ - State Mgmt │    │ - Three.js   │      │
│                      │ - Progress   │    │ - Scene Mgr  │      │
│                      └──────┬───────┘    └──────────────┘      │
│                             │                                    │
│                             ↓                                    │
│                      ┌──────────────┐                           │
│                      │ API Service  │                           │
│                      │ - Job Polling│                           │
│                      │ - Retry Logic│                           │
│                      └──────┬───────┘                           │
│                             │                                    │
│                             │ HTTP Requests                      │
└─────────────────────────────┼─────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND (Express.js)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │/api/generate │───→│  Job Queue   │───→│  AI Service  │      │
│  │   Routes     │    │              │    │              │      │
│  └──────────────┘    │ - Track Jobs │    │ - Gemini API │      │
│                      │ - Progress   │    │ - Extract    │      │
│                      └──────────────┘    └──────┬───────┘      │
│                                                  │               │
│                                                  ↓               │
│                                          ┌──────────────┐        │
│                                          │  Geometry    │        │
│                                          │  Generator   │        │
│                                          │              │        │
│                                          └──────────────┘        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. User Input → Job Creation
```javascript
User enters: "Create a 15-story office tower with glass curtain walls"
      ↓
App.jsx: handleGenerateDesign(prompt)
      ↓
api.js: generateDesign(prompt, onProgress)
      ↓
POST /api/generate { prompt }
      ↓
Backend: jobQueue.createJob(prompt, options)
      ↓
Returns: { success: true, jobId: "abc123", status: "queued" }
```

### 2. Job Processing (Backend)
```javascript
processGenerationJob(jobId, prompt, options)
      ↓
Stage 1: Analyzing (10-50%)
  ├─→ geminiService.analyzePrompt(prompt)
  ├─→ Extract: objectCount, elements, dimensions, details
  └─→ Returns: specifications
      ↓
Stage 2: Generating (20-80%)
  ├─→ geometryGenerator.generateFromSpec(specifications)
  ├─→ Creates: composite with 351 parts for complex building
  │   ├─ Main structure (1)
  │   ├─ Floor slabs (14)
  │   ├─ Curtain wall panels (300)
  │   ├─ Window frames (14)
  │   ├─ Entrance features (3)
  │   ├─ Rooftop elements (3)
  │   └─ Structural columns (16)
  └─→ Returns: modelData with parts array
      ↓
Stage 3: Refining (30-90%)
  ├─→ Apply LOD based on objectCount
  ├─→ Set optimization flags
  └─→ Returns: refined modelData
      ↓
Stage 4: Exporting (50-100%)
  ├─→ Prepare export formats
  └─→ Store in job.result
```

### 3. Job Polling (Frontend)
```javascript
Every 1 second:
  GET /api/generate/:jobId
      ↓
  Returns: {
    status: "analyzing" | "generating" | "refining" | "completed",
    progress: 0-100,
    stages: { analyzing: {...}, generating: {...}, ... },
    result: { design, modelData } // when completed
  }
      ↓
  onProgress callback updates UI
      ↓
  Repeat until status === "completed"
```

### 4. Model Conversion (Frontend)
```javascript
Job completes with modelData:
{
  type: "composite",
  parts: [
    { type: "box", dimensions: {x:20000, y:45000, z:15000}, 
      position: {x:0, y:22500, z:0}, material: "concrete" },
    // ... 350 more parts
  ]
}
      ↓
geometryConverter.convertModelDataToSceneObjects(modelData)
      ↓
For each part:
  ├─→ Convert dimensions: mm → meters (scaled 0.1x)
  ├─→ Convert position: mm → meters
  ├─→ Map material: "concrete" → { color: "#CCCCCC", metalness: 0.1, roughness: 0.9 }
  ├─→ Create geometry object based on type
  └─→ Generate unique ID
      ↓
Returns: [
  {
    id: "AI_Model_part_0_...",
    type: "box",
    geometry: { type: "box", width: 2, height: 4.5, depth: 1.5 },
    position: { x: 0, y: 2.25, z: 0 },
    material: { color: "#CCCCCC", metalness: 0.1, roughness: 0.9 },
    name: "AI_Model_part_0",
    visible: true,
    userData: { aiGenerated: true }
  },
  // ... 350 more objects
]
```

### 5. Scene Rendering (Frontend)
```javascript
AdvancedWorkbench receives modelData via useEffect
      ↓
Clear previous AI-generated objects
      ↓
Add new objects to SceneManager
      ↓
SceneRenderer component maps objects to Three.js meshes
      ↓
For each object:
  ├─→ Create Three.js geometry (BoxGeometry, SphereGeometry, etc.)
  ├─→ Create Three.js material (MeshStandardMaterial)
  ├─→ Set position, rotation, scale
  ├─→ Add to scene
  └─→ Enable interaction (click, hover)
      ↓
Render in Canvas with OrbitControls
```

## Component Responsibilities

### Frontend Components

#### App.jsx
- **Purpose:** Main application controller
- **Responsibilities:**
  - Manage application state (design, loading, progress, modelData)
  - Handle generation requests
  - Track progress and update UI
  - Pass modelData to AdvancedWorkbench
  - Display progress bar and stage indicators
- **Key State:**
  - `modelData`: Current AI-generated model
  - `generationProgress`: Job progress info
  - `loading`: Generation in progress flag

#### api.js (APIService)
- **Purpose:** API communication layer
- **Responsibilities:**
  - Send generation requests to backend
  - Poll job status until completion
  - Handle timeouts and errors
  - Provide progress updates via callback
- **Key Methods:**
  - `generateDesign(prompt, onProgress)`: Start job and poll
  - `pollJobStatus(jobId, onProgress)`: Check job status
  - `cancelJob(jobId)`: Cancel running job

#### geometryConverter.js
- **Purpose:** Data transformation layer
- **Responsibilities:**
  - Convert backend geometry format to SceneManager format
  - Scale dimensions (mm → meters)
  - Map material names to colors and properties
  - Generate unique IDs for objects
- **Key Functions:**
  - `convertModelDataToSceneObjects(modelData)`: Main conversion
  - `convertPartToSceneObject(part)`: Convert single part
  - `convertGeometry(part)`: Type-specific geometry conversion
  - `convertMaterial(name)`: Material mapping

#### AdvancedWorkbench.jsx
- **Purpose:** 3D viewer and editor
- **Responsibilities:**
  - Render Three.js scene
  - Accept modelData prop
  - Add AI-generated objects to scene
  - Handle user interactions (rotate, zoom, select)
  - Manage tool system
- **Key Effects:**
  - `useEffect([modelData])`: Process incoming AI models

### Backend Services

#### generate.js (Routes)
- **Purpose:** API endpoint handlers
- **Endpoints:**
  - `POST /api/generate`: Create generation job
  - `GET /api/generate/:jobId`: Get job status
  - `DELETE /api/generate/:jobId`: Cancel job
- **Responsibilities:**
  - Create jobs
  - Start async processing
  - Return job status
  - Handle errors

#### jobQueue.js
- **Purpose:** Job management system
- **Responsibilities:**
  - Track job state and progress
  - Update job stages
  - Store results
  - Handle timeouts
- **Job Structure:**
  ```javascript
  {
    id, status, progress, createdAt, updatedAt,
    stages: {
      analyzing: { status: "completed", progress: 100 },
      generating: { status: "in_progress", progress: 50 },
      refining: { status: "pending", progress: 0 },
      exporting: { status: "pending", progress: 0 }
    },
    result: { design, modelData }
  }
  ```

#### geminiService.js
- **Purpose:** AI integration layer
- **Responsibilities:**
  - Call Google Gemini API
  - Parse AI responses
  - Extract structured specifications
  - Handle retries and errors
- **Enhanced Features:**
  - Detailed prompt engineering with examples
  - Architectural term recognition
  - Dimension calculation (floors × floor_height)
  - Detail extraction (windows, balconies, etc.)

#### geometryGenerator.js
- **Purpose:** 3D geometry creation
- **Responsibilities:**
  - Generate procedural geometry
  - Create detailed architectural elements
  - Support multiple building types
  - Apply LOD based on complexity
- **Enhanced Features:**
  - Curtain wall facades (300+ panels)
  - Window frames and mullions
  - Balconies with railings
  - Entrance features (canopy, pillars)
  - Rooftop elements (parapet, mechanical)
  - Structural columns
  - Underground parking indicators

## Performance Considerations

### Backend
- **Job Queue:** Limits concurrent jobs to 5
- **LOD System:** Reduces detail for complex scenes
  - objectCount > 100: low detail
  - objectCount > 10: medium detail
  - objectCount ≤ 10: high detail
- **Timeouts:** 5 minute job timeout

### Frontend
- **Polling Interval:** 1 second (configurable)
- **Timeout:** 120 seconds (configurable)
- **Conversion:** Scales dimensions 0.1x for better viewport fit
- **Rendering:** Uses Three.js instancing where possible

## Error Handling

### Frontend
- Network errors → Display error message
- Timeout → "Generation timeout" message
- Job failed → Display job error message
- Cancel → Stop polling, clear loading state

### Backend
- Gemini API errors → Retry up to 3 times
- Parse errors → Fallback to default specifications
- Job failures → Mark job as failed, store error

## Material System

Backend materials → Frontend colors:
- `concrete` → `#CCCCCC` (gray, rough)
- `glass` → `#88CCFF` (blue-tint, smooth)
- `metal` → `#888888` (dark gray, metallic)
- `wood` → `#8B4513` (brown, rough)
- `stone` → `#696969` (dark gray, very rough)
- `brick` → `#B22222` (red, rough)
- `plastic` → `#FFFFFF` (white, semi-smooth)

## Scaling and Units

- **Backend:** Uses millimeters (architectural standard)
  - Typical building: 20,000mm × 45,000mm × 15,000mm
  - Floor height: 3,000-4,000mm
- **Frontend:** Uses meters (Three.js standard)
  - Scaled 0.1x for better viewport fit
  - Final display: 2m × 4.5m × 1.5m

## Extension Points

### Adding New Geometry Types
1. Add generation method to `geometryGenerator.js`
2. Add conversion case to `geometryConverter.js`
3. Ensure SceneManager supports the type

### Adding New Materials
1. Add color to `MATERIAL_COLORS` in converter
2. Add properties to `MATERIAL_PROPERTIES` in converter
3. Backend can use the material name

### Adding New Building Features
1. Add detail name to Gemini prompt examples
2. Add generation method to `geometryGenerator.js`
3. Check for detail in `generateBuilding()` method

## Security Considerations

- ✅ Input validation on API endpoints
- ✅ Rate limiting on API routes
- ✅ CORS configuration for allowed origins
- ✅ No code injection vulnerabilities (verified by CodeQL)
- ✅ API key stored in environment variables
- ✅ No sensitive data in frontend code

## Monitoring and Debugging

### Frontend Console Logs
- Job creation and polling
- Model data reception
- Conversion progress
- Object addition to scene

### Backend Console Logs
- Job stage transitions
- AI API calls
- Geometry generation stats
- Error stack traces

### Network Monitoring
- API request/response times
- Polling frequency
- Payload sizes

## Future Enhancements

1. **Real-time Updates:** WebSocket for live progress
2. **Caching:** Store generated models for reuse
3. **Optimization:** Geometry simplification for performance
4. **Export:** Download generated models (OBJ, GLTF)
5. **Editing:** Modify AI-generated models in editor
6. **Materials:** Add textures and advanced materials
7. **Lighting:** Enhanced lighting for architectural renders
