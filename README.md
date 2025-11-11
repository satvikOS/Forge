# ArchDisc - AI-Powered Design Platform

ArchDisc is an AI-powered design platform that lets anyone create and build any object from cars to buildings through natural prompts or sketches. It unifies ideation, 3D modeling, analysis, and legality into one intelligent workspace.

## Features

- **Natural Language Design**: Describe what you want to create in plain English
- **3D Visualization**: Real-time 3D model rendering with interactive controls
- **AI-Powered Generation**: Leverages AI to interpret prompts and generate detailed specifications
- **Structural Analysis**: Automatic analysis of strength, stability, and safety
- **Cost Estimation**: Instant manufacturing/construction cost estimates
- **Compliance Checking**: Automated verification against building codes and safety standards
- **Multi-Domain Support**: Design cars, buildings, furniture, and more

## Tech Stack

### Backend
- **Node.js** with Express
- **OpenAI API** for natural language processing
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

1. Configure backend environment variables:
```bash
cd backend
cp .env.example .env
```

Edit `.env` and set your configuration:
- `PORT`: Backend server port (default: 5000)
- `OPENAI_API_KEY`: Your OpenAI API key (set to 'demo-mode' for demo responses)

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

## Demo Mode

The platform can run in demo mode without an OpenAI API key. Set `OPENAI_API_KEY=demo-mode` in your `.env` file. Demo mode provides pre-configured responses for:
- Cars
- Buildings
- Furniture

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
