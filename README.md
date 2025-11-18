# ArchDisc - AI-Powered Design Platform

ArchDisc is an AI-powered design platform that lets anyone create and build any object from cars to buildings through natural prompts or sketches. It unifies ideation, 3D modeling, analysis, and legality into one intelligent workspace.

## ✨ New: Comprehensive 3D Editor

ArchDisc now includes a **professional-grade 3D editor** with 70+ tools for manual 3D design! Switch between AI-powered generation and hands-on modeling.

### Key 3D Editor Features

- 🎨 **70+ Professional Tools**: Complete toolset including selection, transform, modeling, drawing, and measurement tools
- 🏗️ **Modular Architecture**: Industry-standard tool system inspired by Blender and SketchUp
- ⌨️ **Full Keyboard Support**: Professional shortcuts (G=Move, R=Rotate, E=Extrude, etc.)
- 📁 **File I/O**: Save/load projects, export to OBJ, STL, GLTF, GLB
- 🔄 **Undo/Redo**: 50-level history system
- 🎨 **Material System**: 10+ presets with full customization
- 🔧 **Modifier System**: Non-destructive editing with 8 modifiers
- 📏 **Measurement Tools**: Distance, angle, area, volume calculations
- 📐 **Drawing Tools**: Professional line, rectangle, circle, polygon tools
- 📷 **Camera System**: View presets and smart framing
- ❓ **Help System**: Comprehensive documentation and shortcuts

**See the [3D Editor Guide](./3D_EDITOR_GUIDE.md) for complete documentation.**

## ✨ New: Sketchfab Integration

Browse, preview, and embed 3D architectural models from **Sketchfab** directly in ArchDisc!

### Sketchfab Features

- 🔍 **Model Browser**: Search and browse thousands of architectural models
- 🎨 **Interactive Viewer**: View 3D models with full controls (rotate, zoom, VR mode)
- 📎 **Discovery Integration**: Attach multiple models to your discoveries
- 🏗️ **Categories & Filters**: Filter by architecture, cultural heritage, and more
- 👤 **OAuth Support**: Connect your Sketchfab account (optional)

**See the [Sketchfab Integration Guide](./SKETCHFAB_INTEGRATION.md) for setup and usage.**

## Features

- **Natural Language Design**: Describe what you want to create in plain English
- **3D Visualization**: Real-time 3D model rendering with interactive controls
- **Sketchfab Integration**: Browse and embed 3D architectural models
- **AI-Powered Generation**: Leverages AI to interpret prompts and generate detailed specifications
- **Structural Analysis**: Automatic analysis of strength, stability, and safety
- **Cost Estimation**: Instant manufacturing/construction cost estimates
- **Compliance Checking**: Automated verification against building codes and safety standards
- **Multi-Domain Support**: Design cars, buildings, furniture, and more

## Tech Stack

### Backend
- **Node.js** with Express
- **Google Gemini API** for natural language processing
- RESTful API architecture
- Modular service-based design

### Frontend
- **React** with Vite
- **Three.js** with React Three Fiber for 3D rendering
- **React Three Drei** for enhanced 3D components
- Responsive and modern UI

## Deployment

### Deploy to Vercel

ArchDisc is fully configured for one-click deployment to Vercel. See the [Vercel Deployment Guide](./VERCEL_DEPLOYMENT.md) for detailed instructions.

**Quick Deploy:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/satvikOS/archdiscv1)

For step-by-step instructions, environment variables, and troubleshooting, refer to [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/satvikOS/archdiscv1.git
cd archdiscv1
```

2. Install backend dependencies:
```bash
cd backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

### Configuration

**Important**: The `.env` file is not tracked by git for security. You must create it from the template:

1. Configure backend environment variables:
```bash
cd backend
cp .env.example .env
```

2. Edit `backend/.env` and set your configuration:
- `PORT`: Backend server port (default: 5000)
- `GEMINI_API_KEY`: Your Google Gemini API key (required for AI features)
- `SKETCHFAB_API_TOKEN`: Your Sketchfab API token (optional, for 3D model integration)
- `SKETCHFAB_ENABLED`: Set to `true` to enable Sketchfab features (default: false)

**Note**: If you previously had a `.env` file with your Gemini API key, you'll need to create it again from `.env.example`. The `.env` file is intentionally not committed to prevent exposing your API keys.

### Running the Application

1. Start the backend server:
```bash
cd backend
npm start
```

The backend will run on http://localhost:5000

2. In a new terminal, start the frontend:
```bash
cd frontend
npm run dev
```

The frontend will run on http://localhost:3000

3. Open your browser and navigate to http://localhost:3000

## Usage

1. **Enter a Design Prompt**: Describe what you want to design in the text area
   - Example: "Design a modern sports car"
   - Example: "Create a contemporary office building"
   - Example: "Design an ergonomic office chair"

2. **Generate Design**: Click "Generate Design" to create your 3D model

3. **View Results**: 
   - 3D model appears in the viewer (use mouse to rotate, zoom, pan)
   - Design specifications displayed in the left panel
   - Analysis results show structural integrity and cost estimates
   - Compliance checks indicate regulatory compliance

4. **Interact with 3D Model**:
   - Left click + drag to rotate
   - Right click + drag to pan
   - Scroll to zoom

## API Endpoints

### Design Generation
- `POST /api/design/generate` - Generate design from prompt
- `GET /api/design/:id` - Get design by ID

### Analysis
- `POST /api/analysis/analyze` - Comprehensive design analysis
- `POST /api/analysis/structural` - Structural analysis only
- `POST /api/analysis/cost` - Cost estimation

### Compliance
- `POST /api/legality/check` - Check design compliance
- `GET /api/legality/standards/:objectType` - Get applicable standards

### Health
- `GET /api/health` - API health check

## Project Structure

```
archdiscv1/
├── backend/
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── models/          # Data models (future)
│   ├── utils/           # Utilities (future)
│   ├── server.js        # Main server file
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── services/    # API service layer
│   │   ├── styles/      # CSS styles
│   │   ├── App.jsx      # Main App component
│   │   └── main.jsx     # Entry point
│   ├── public/          # Static assets
│   ├── index.html       # HTML template
│   ├── vite.config.js   # Vite configuration
│   └── package.json
└── README.md
```

## Features in Detail

### AI-Powered Design Generation
The platform uses advanced AI to understand natural language prompts and generate detailed design specifications including:
- Object type classification
- Dimensions and measurements
- Material suggestions
- Design style and aesthetics
- Functional requirements

### 3D Modeling
Automatic generation of 3D geometry from specifications:
- Composite shapes for complex objects
- Basic primitives (boxes, spheres, cylinders)
- Material rendering
- Interactive viewing

### Analysis Engine
Comprehensive analysis including:
- **Structural Analysis**: Strength, stability, safety factors
- **Material Analysis**: Properties, weight, cost, durability
- **Performance Analysis**: Domain-specific metrics
- **Cost Estimation**: Materials, labor, overhead breakdown

### Compliance Checking
Automated verification against:
- Building codes (height, fire safety, accessibility)
- Safety standards (material safety, crash tests, emissions)
- Environmental compliance (sustainability, energy efficiency)
- Manufacturing standards (quality control, certifications)

## AI Model

This platform uses **Google Gemini 2.5 Pro Experimental**, the most advanced model for:
- Understanding complex 3D design prompts
- Generating detailed architectural specifications
- Providing accurate material and structural recommendations
- Creating comprehensive design analysis

Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

## Future Enhancements

- Sketch-to-design conversion
- Export to CAD formats (STL, OBJ, STEP)
- Collaboration features
- Design history and versioning
- Advanced materials database
- Real-time collaboration
- Mobile app

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Contact

For questions or support, please open an issue on GitHub.
