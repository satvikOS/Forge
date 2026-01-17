# Phase 1 System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│                    (React Frontend - Vite)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐         ┌──────────────────────┐         │
│  │  PromptInput    │────────▶│  VariantSelector     │         │
│  │  Component      │         │  Component           │         │
│  └─────────────────┘         └──────────────────────┘         │
│         │                              │                        │
│         │ User enters prompt           │ User selects variant  │
│         ▼                              ▼                        │
│  ┌──────────────────────────────────────────────────┐         │
│  │           App.jsx State Management               │         │
│  │  - variants[]                                     │         │
│  │  - selectedVariant                                │         │
│  │  - modelData                                      │         │
│  └──────────────────────────────────────────────────┘         │
│         │                                                       │
│         │ handleGenerateDesign()                               │
│         ▼                                                       │
│  ┌──────────────────────────────────────────────────┐         │
│  │          API Service (api.js)                    │         │
│  │  generateVariants(prompt, options)               │         │
│  └──────────────────────────────────────────────────┘         │
│         │                                                       │
└─────────┼───────────────────────────────────────────────────────┘
          │ POST /api/generate/variants
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API SERVER                           │
│                    (Node.js + Express)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────┐         │
│  │     Generate Route (generate.js)                 │         │
│  │     POST /api/generate/variants                  │         │
│  └──────────────────────────────────────────────────┘         │
│         │                                                       │
│         ├─────────────────┬─────────────────┐                 │
│         ▼                 ▼                 ▼                  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐         │
│  │  Real-World  │  │   Multi-     │  │  Gemini AI  │         │
│  │  Reference   │  │   Variant    │  │  Service    │         │
│  │  System      │  │  Generator   │  │             │         │
│  └──────────────┘  └──────────────┘  └─────────────┘         │
│         │                 │                                     │
│         │                 │                                     │
└─────────┼─────────────────┼─────────────────────────────────────┘
          │                 │
          ▼                 ▼
    External APIs      Google Gemini 2.0
    (Wikipedia         Flash Experimental
     Wikidata)         API
```

## Detailed Data Flow

### 1. Request Phase

```
User Types "Eiffel Tower"
         │
         ▼
┌────────────────────┐
│  PromptInput       │
│  Component         │
└────────────────────┘
         │
         │ onSubmit
         ▼
┌────────────────────┐
│  App.jsx           │
│  handleGenerate    │
│  Design()          │
└────────────────────┘
         │
         │ setLoading(true)
         │ setVariants([])
         ▼
┌────────────────────┐
│  apiService        │
│  .generateVariants │
└────────────────────┘
         │
         │ axios.post()
         ▼
  Backend API
  /api/generate/variants
```

### 2. Backend Processing Phase

```
POST /api/generate/variants
  { prompt: "Eiffel Tower" }
         │
         ▼
┌──────────────────────────────────┐
│  generate.js Route Handler       │
│                                  │
│  1. Validate prompt              │
│  2. Extract coordinates (if any) │
│  3. Initialize services          │
└──────────────────────────────────┘
         │
         ├─────────────── Parallel Execution ───────────────┐
         │                                                   │
         ▼                                                   ▼
┌──────────────────────────┐              ┌──────────────────────────┐
│  RealWorldReferenceSystem│              │  MultiVariantGenerator   │
│                          │              │                          │
│  1. Check cache          │              │  Prepare 3 variant styles│
│  2. Search Wikipedia     │              │  - Photorealistic        │
│  3. Fetch article data   │              │  - Engineering Detail    │
│  4. Search Wikidata      │              │  - Artistic Quality      │
│  5. Fetch entity data    │              │                          │
│  6. Extract dimensions   │              │  (Waits for reference    │
│  7. Extract materials    │              │   data to complete)      │
│  8. Cache results        │              │                          │
└──────────────────────────┘              └──────────────────────────┘
         │                                                   │
         │ Return realWorldData                             │
         │ {                                                 │
         │   wikipedia: {...},                               │
         │   wikidata: {                                     │
         │     dimensions: {height: 324},                    │
         │     materials: [...]                              │
         │   }                                               │
         │ }                                                 │
         └────────────────┬──────────────────────────────────┘
                          ▼
         ┌──────────────────────────────────┐
         │  MultiVariantGenerator           │
         │  .generateVariants()             │
         │                                  │
         │  Build context with:             │
         │  - Base prompt                   │
         │  - Real-world data               │
         │  - Coordinates (if any)          │
         └──────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
         ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ Variant 1│    │ Variant 2│    │ Variant 3│
   │  Photo-  │    │Engineer- │    │ Artistic │
   │ realistic│    │  ing     │    │ Quality  │
   └──────────┘    └──────────┘    └──────────┘
         │                │                │
         │  Gemini API    │  Gemini API    │  Gemini API
         ▼                ▼                ▼
   ┌────────────────────────────────────────┐
   │     Google Gemini 2.0 Flash Exp       │
   │                                        │
   │  Generates detailed JSON for each     │
   │  variant with:                        │
   │  - Name & description                 │
   │  - Dimensions (width, height, depth)  │
   │  - Materials list                     │
   │  - Element specifications             │
   │  - Technical details                  │
   │  - Metadata (complexity, realism)     │
   └────────────────────────────────────────┘
         │                │                │
         └────────────────┴────────────────┘
                          │
         ┌────────────────▼────────────────┐
         │  Parse & Validate JSON          │
         │  - Check required fields        │
         │  - Fallback on errors           │
         │  - Add timestamps               │
         └─────────────────────────────────┘
                          │
                          ▼
         ┌─────────────────────────────────┐
         │  Return Response:               │
         │  {                              │
         │    success: true,               │
         │    variants: [variant1, v2, v3],│
         │    realWorldData: {...},        │
         │    metadata: {...}              │
         │  }                              │
         └─────────────────────────────────┘
```

### 3. Response Phase

```
Backend Response
         │
         ▼
┌──────────────────────┐
│  apiService          │
│  receives response   │
└──────────────────────┘
         │
         │ return response.data
         ▼
┌──────────────────────┐
│  App.jsx             │
│  handleGenerate      │
│  Design()            │
└──────────────────────┘
         │
         │ Parse variants
         ▼
┌──────────────────────┐
│  Set State:          │
│  - variants = [...]  │
│  - selectedVariant=0 │
│  - modelData = v[0]  │
└──────────────────────┘
         │
         │ Trigger re-render
         ▼
┌──────────────────────┐
│  VariantSelector     │
│  Component Renders   │
│                      │
│  Displays 3 cards:   │
│  [Photo][Eng][Art]   │
└──────────────────────┘
```

### 4. User Interaction Phase

```
User Clicks Variant Card
         │
         ▼
┌──────────────────────┐
│  VariantSelector     │
│  onClick handler     │
└──────────────────────┘
         │
         │ onVariantSelect(index)
         ▼
┌──────────────────────┐
│  App.jsx             │
│  handleVariant       │
│  Select(index)       │
└──────────────────────┘
         │
         ├── setSelectedVariant(index)
         │
         ├── Update modelData with variant[index]
         │
         └── Update design object
                  │
                  ▼
         ┌──────────────────┐
         │  3D Viewer       │
         │  (if implemented)│
         │  Updates display │
         └──────────────────┘
```

## Component Communication

```
┌─────────────────────────────────────────────────────────────┐
│                         App.jsx                             │
│                     (Parent Component)                      │
│                                                             │
│  State:                                                     │
│  ├── variants: Array<Variant>                              │
│  ├── selectedVariant: number                               │
│  ├── modelData: ModelData                                  │
│  ├── design: Design                                        │
│  └── loading: boolean                                      │
│                                                             │
│  Functions:                                                 │
│  ├── handleGenerateDesign(prompt)                          │
│  ├── handleVariantSelect(index)                            │
│  └── convertVariantToModelData(variant, prompt)            │
└─────────────────────────────────────────────────────────────┘
         │                              │
         │ Props                        │ Props
         ▼                              ▼
┌────────────────────┐     ┌──────────────────────────┐
│  PromptInput       │     │  VariantSelector         │
│                    │     │                          │
│  Props:            │     │  Props:                  │
│  - onSubmit        │     │  - variants[]            │
│  - loading         │     │  - selectedVariant       │
│                    │     │  - onVariantSelect()     │
└────────────────────┘     └──────────────────────────┘
                                      │
                                      │ Renders
                                      ▼
                           ┌────────────────────┐
                           │  VariantCard       │
                           │  (3 instances)     │
                           │                    │
                           │  - Badge           │
                           │  - Metadata        │
                           │  - Details         │
                           │  - Selection       │
                           └────────────────────┘
```

## Data Structures

### Variant Object
```javascript
{
  style: "photorealistic",
  title: "Photorealistic",
  name: "Eiffel Tower - Photorealistic",
  description: "Ultra-realistic recreation with accurate...",
  dimensions: {
    width: 125,
    height: 324,
    depth: 125
  },
  materials: ["wrought iron", "steel"],
  elements: [
    {
      type: "tower_base",
      dimensions: {...},
      position: {...},
      material: "wrought iron"
    }
  ],
  details: {
    structuralFeatures: ["Four pillars", "Lattice structure"],
    visualCharacteristics: ["Rustic iron patina"],
    technicalSpecs: ["18,038 metal parts"]
  },
  metadata: {
    complexity: "high",
    realism: "high",
    historicalAccuracy: "high",
    generatedAt: "2024-01-01T00:00:00.000Z"
  }
}
```

### Real-World Data Object
```javascript
{
  subject: "Eiffel Tower",
  wikipedia: {
    title: "Eiffel Tower",
    pageId: 9870,
    url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
    summary: "The Eiffel Tower is a wrought-iron...",
    thumbnail: "https://...",
    image: "https://...",
    infobox: {
      height: 324,
      architect: "Gustave Eiffel",
      completionDate: "1889",
      location: "Paris, France"
    }
  },
  wikidata: {
    entityId: "Q243",
    label: "Eiffel Tower",
    description: "tower in Paris, France",
    url: "https://www.wikidata.org/wiki/Q243",
    dimensions: {
      height: 324,
      baseWidth: 125
    },
    materials: ["Q11421"],
    architect: "Q20882",
    inceptionDate: "1889",
    location: {
      latitude: 48.8584,
      longitude: 2.2945
    }
  },
  fetchedAt: "2024-01-01T00:00:00.000Z",
  fetchTime: 1234
}
```

## API Endpoints

### POST /api/generate/variants

**Request:**
```json
{
  "prompt": "Eiffel Tower",
  "options": {}
}
```

**Response:**
```json
{
  "success": true,
  "prompt": "Eiffel Tower",
  "variants": [
    {/* Variant 1 */},
    {/* Variant 2 */},
    {/* Variant 3 */}
  ],
  "realWorldData": {
    "hasWikipedia": true,
    "hasWikidata": true,
    "dimensions": {"height": 324},
    "materials": ["Q11421"]
  },
  "metadata": {
    "generatedAt": "2024-01-01T00:00:00.000Z",
    "variantCount": 3,
    "hasRealWorldData": true
  }
}
```

## Performance Considerations

### Parallel Processing
```
Sequential (OLD):
Variant 1: ████████ 5s
           Variant 2: ████████ 5s
                      Variant 3: ████████ 5s
Total: 15 seconds

Parallel (NEW):
Variant 1: ████████ 5s
Variant 2: ████████ 5s
Variant 3: ████████ 5s
Total: 5 seconds (3x faster!)
```

### Caching Strategy
```
First Request: "Eiffel Tower"
├─ Wikipedia Fetch: 1s ─┐
├─ Wikidata Fetch: 1s   ├─ Cache stored
├─ Variant Gen: 5s      │
└─ Total: 7s            │
                        │
Second Request: "Eiffel Tower"
├─ Wikipedia: CACHED ◄──┘
├─ Wikidata: CACHED ◄───┘
├─ Variant Gen: 5s
└─ Total: 5s (28% faster)
```

## Error Handling Flow

```
API Call
    │
    ▼
[Try Multi-Variant]
    │
    ├─ Success ──────────────► Return variants
    │
    └─ Failure
         │
         ▼
    [Try Standard Generation]
         │
         ├─ Success ────────► Return design
         │
         └─ Failure
              │
              ▼
         [Show Error Message]
              │
              └──► "Failed to generate design"
```

---

**Legend:**
- `│ ▼ ├ └` = Data flow
- `┌ ─ ┐` = Component boundaries
- `[...]` = Process/function
- `{...}` = Data structure
- `====` = Parallel execution
