/**
 * Text-to-Code Generation Service
 * Generates procedural 3D code from natural language descriptions
 */

const bedrockService = require('./bedrockService');

class TextToCodeService {
    constructor() {
        this.bedrock = bedrockService;
        this.supportedLanguages = ['javascript', 'python', 'glsl', 'openscad'];
    }

    /**
     * Generate procedural 3D code from text description
     */
    async generateCode(description, options = {}) {
        const {
            language = 'javascript', // javascript, python, glsl, openscad
            framework = 'three.js', // three.js, babylon.js, blender, openscad
            includeComments = true,
            optimizationLevel = 'balanced' // performance, balanced, readability
        } = options;

        console.log(`💻 Generating ${language} code...`);
        console.log(`   Description: "${description.substring(0, 50)}..."`);
        console.log(`   Framework: ${framework}`);

        // Step 1: Analyze requirements
        const requirements = await this.analyzeRequirements(description);

        // Step 2: Generate code structure
        const codeStructure = await this.generateCodeStructure(requirements, language, framework);

        // Step 3: Generate actual code
        const code = await this.generateActualCode(codeStructure, includeComments, optimizationLevel);

        // Step 4: Add documentation
        const documentation = await this.generateDocumentation(code, description);

        console.log(`✅ Code generated (${code.length} characters)`);

        return {
            code,
            language,
            framework,
            documentation,
            requirements,
            metadata: {
                description: description.substring(0, 100),
                generatedAt: new Date().toISOString(),
                lineCount: code.split('\n').length
            }
        };
    }

    /**
     * Analyze requirements from description
     */
    async analyzeRequirements(description) {
        const prompt = `Analyze this 3D modeling request and extract requirements:
"${description}"

Return JSON with:
{
  "geometryType": "procedural|parametric|organic",
  "complexity": "simple|moderate|complex",
  "requiredFunctions": [...],
  "parameters": [...],
  "animations": true/false,
  "interactivity": true/false
}`;

        const response = await this.bedrock.generateContent(prompt);

        try {
            return JSON.parse(response);
        } catch {
            return {
                geometryType: 'procedural',
                complexity: 'moderate',
                requiredFunctions: ['createGeometry', 'render'],
                parameters: [],
                animations: false,
                interactivity: false
            };
        }
    }

    /**
     * Generate code structure
     */
    async generateCodeStructure(requirements, language, framework) {
        const prompt = `Generate code structure for this 3D model:
Requirements: ${JSON.stringify(requirements, null, 2)}
Language: ${language}
Framework: ${framework}

Return JSON with:
{
  "imports": [...],
  "globalVariables": [...],
  "functions": [{ "name": "...", "params": [...], "purpose": "..." }],
  "mainFlow": [...]
}`;

        const response = await this.bedrock.generateContent(prompt);

        try {
            return JSON.parse(response);
        } catch {
            return this.getDefaultStructure(framework);
        }
    }

    /**
     * Generate actual executable code
     */
    async generateActualCode(structure, includeComments, optimizationLevel) {
        const prompt = `Generate complete, executable code based on this structure:
${JSON.stringify(structure, null, 2)}

Requirements:
- Include ${includeComments ? 'detailed' : 'minimal'} comments
- Optimization: ${optimizationLevel}
- Follow best practices
- Make it production-ready

Return only the code, no explanations.`;

        const code = await this.bedrock.generateContent(prompt);

        // Clean up code (remove markdown code blocks if present)
        return this.cleanCode(code);
    }

    /**
     * Generate code for specific common patterns
     */
    async generatePatternCode(pattern, options = {}) {
        const patterns = {
            'parametric_box': this.generateParametricBox,
            'procedural_terrain': this.generateProceduralTerrain,
            'fractal_tree': this.generateFractalTree,
            'lsystem': this.generateLSystem,
            'voronoi': this.generateVoronoi
        };

        if (patterns[pattern]) {
            return patterns[pattern].call(this, options);
        }

        throw new Error(`Unknown pattern: ${pattern}`);
    }

    /**
     * Pattern: Parametric Box
     */
    generateParametricBox(options) {
        const { width = 1, height = 1, depth = 1 } = options;

        return {
            code: `function createParametricBox(width = ${width}, height = ${height}, depth = ${depth}) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

// Usage
const box = createParametricBox(${width}, ${height}, ${depth});
scene.add(box);`,
            language: 'javascript',
            framework: 'three.js'
        };
    }

    /**
     * Pattern: Procedural Terrain
     */
    generateProceduralTerrain(options) {
        const { size = 100, resolution = 64, amplitude = 10 } = options;

        return {
            code: `function generateTerrain(size = ${size}, resolution = ${resolution}, amplitude = ${amplitude}) {
  const geometry = new THREE.PlaneGeometry(size, size, resolution - 1, resolution - 1);
  const vertices = geometry.attributes.position.array;
  
  // Generate height map using Perlin noise
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    
    // Simple noise function (use proper Perlin noise in production)
    const height = Math.sin(x * 0.1) * Math.cos(y * 0.1) * amplitude;
    vertices[i + 2] = height;
  }
  
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ 
    color: 0x4a7c59,
    flatShading: false
  });
  
  const terrain = new THREE.Mesh(geometry, material);
  terrain.rotation.x = -Math.PI / 2;
  return terrain;
}

// Usage
const terrain = generateTerrain();
scene.add(terrain);`,
            language: 'javascript',
            framework: 'three.js'
        };
    }

    /**
     * Pattern: Fractal Tree
     */
    generateFractalTree(options) {
        const { depth = 5, branchLength = 10, angle = 25 } = options;

        return {
            code: `function createFractalTree(depth = ${depth}, length = ${branchLength}, angle = ${angle}) {
  const tree = new THREE.Group();
  
  function drawBranch(position, direction, currentDepth, currentLength) {
    if (currentDepth === 0) return;
    
    const endPosition = position.clone().add(
      direction.clone().multiplyScalar(currentLength)
    );
    
    // Create branch segment
    const geometry = new THREE.CylinderGeometry(
      currentLength * 0.05,
      currentLength * 0.08,
      currentLength,
      8
    );
    const material = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    const branch = new THREE.Mesh(geometry, material);
    
    // Position and orient branch
    branch.position.copy(position).add(
      direction.clone().multiplyScalar(currentLength / 2)
    );
    const axis = new THREE.Vector3(0, 1, 0);
    branch.quaternion.setFromUnitVectors(axis, direction);
    
    tree.add(branch);
    
    // Recursive branches
    const newLength = currentLength * 0.7;
    const rotationAngle = (angle * Math.PI) / 180;
    
    const right = direction.clone().applyAxisAngle(
      new THREE.Vector3(1, 0, 0), rotationAngle
    );
    const left = direction.clone().applyAxisAngle(
      new THREE.Vector3(1, 0, 0), -rotationAngle
    );
    
    drawBranch(endPosition, right, currentDepth - 1, newLength);
    drawBranch(endPosition, left, currentDepth - 1, newLength);
  }
  
  drawBranch(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 1, 0),
    depth,
    length
  );
  
  return tree;
}

// Usage
const tree = createFractalTree();
scene.add(tree);`,
            language: 'javascript',
            framework: 'three.js'
        };
    }

    /**
     * Generate documentation for code
     */
    async generateDocumentation(code, originalDescription) {
        const prompt = `Generate documentation for this generated code:

Original request: "${originalDescription}"

Code:
\`\`\`
${code}
\`\`\`

Create markdown documentation with:
1. Overview
2. Parameters
3. Usage examples
4. Notes/Tips`;

        const docs = await this.bedrock.generateContent(prompt);
        return docs;
    }

    /**
     * Generate shader code (GLSL)
     */
    async generateShaderCode(description, shaderType = 'fragment') {
        const prompt = `Generate GLSL ${shaderType} shader code for:
"${description}"

Return complete, working shader code with:
- Uniforms for customization
- Proper variable declarations
- Efficient calculations
- Comments explaining key parts`;

        const shaderCode = await this.bedrock.generateContent(prompt);
        return this.cleanCode(shaderCode);
    }

    // Helper methods

    getDefaultStructure(framework) {
        return {
            imports: ['THREE'],
            globalVariables: ['scene', 'camera', 'renderer'],
            functions: [
                { name: 'init', params: [], purpose: 'Initialize scene' },
                { name: 'createGeometry', params: [], purpose: 'Create 3D geometry' },
                { name: 'animate', params: [], purpose: 'Animation loop' }
            ],
            mainFlow: ['init()', 'createGeometry()', 'animate()']
        };
    }

    cleanCode(code) {
        // Remove markdown code blocks
        let cleaned = code.replace(/```[\w]*\n/g, '').replace(/```/g, '');

        // Remove leading/trailing whitespace
        cleaned = cleaned.trim();

        return cleaned;
    }
}

module.exports = new TextToCodeService();
