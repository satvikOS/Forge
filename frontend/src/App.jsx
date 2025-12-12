import { useState, useEffect, useCallback, useRef } from 'react';
import BottomPromptBar from './components/BottomPromptBar';
import WorkbenchViewer from './components/WorkbenchViewer';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import MenuBar from './components/MenuBar';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import AdvancedWorkbench from './components/AdvancedWorkbench';
import PropertiesPanel from './components/PropertiesPanel';
import AdvancedToolbar from './components/AdvancedToolbar';
import SceneHierarchyPanel from './components/SceneHierarchyPanel';
import HelpPanel from './components/HelpPanel';
import VariantSelector from './components/VariantSelector';
// New professional 3D platform components
import TimelineEditor from './components/timeline/TimelineEditor';
import GizmoControls from './components/gizmos/GizmoControls';
import ViewportOverlays from './components/ViewportOverlays';
import ProjectSettings from './components/ProjectSettings';
import NPCCrowdPanel from './components/NPCCrowdPanel';
import ProceduralWorldBuilder from './components/ProceduralWorldBuilder';
// import GeospatialViewer from './components/geospatial/GeospatialViewer'; // Kept for future internal use
import SceneManager from './systems/SceneManager';
import { MaterialLibrary } from './systems/MaterialLibrary';
import { saveProject, loadProject, exportToOBJ, exportToSTL, exportToGLTF } from './systems/FileExport';
import { handleAddPrimitive } from './utils/addPrimitive';
import apiService from './services/api';
import './styles/index.css';

function App() {
  const [design, setDesign] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('solid');
  const [showWorkbench, setShowWorkbench] = useState(false);
  // const [appMode, setAppMode] = useState('studio'); // Reverted to single mode

  const [isExploded, setIsExploded] = useState(false);

  // 3D modeling state
  const [currentMode, setCurrentMode] = useState('object');
  const [activeTool, setActiveTool] = useState('select');
  const [showGrid, setShowGrid] = useState(true);
  const [showSnap, setShowSnap] = useState(false);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 });
  const [selectedObjects, setSelectedObjects] = useState([]);
  const [selectionCount, setSelectionCount] = useState({ objects: 0 });

  // Advanced workbench state
  const [sceneInfo, setSceneInfo] = useState({ selectedCount: 0, totalObjects: 0 });
  const sceneManagerRef = useRef(new SceneManager());
  const [showHelp, setShowHelp] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);

  // Generation progress state
  const [generationProgress, setGenerationProgress] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null);
  const [modelData, setModelData] = useState(null);

  // Multiple designs tracking (Issue #27)
  const [designs, setDesigns] = useState([]);

  // Multi-variant generation state (Phase 1)
  const [variants, setVariants] = useState([]);
  const [selectedVariant, setSelectedVariant] = useState(0);

  // Fantasy generation mode state (Nano Banana Pro integration)
  const [generationMode, setGenerationMode] = useState('realistic'); // 'realistic' or 'fantasy'

  // State for creating design from variant
  const [isCreatingDesign, setIsCreatingDesign] = useState(false);

  // Environment system reference for scene composition
  const environmentSystemRef = useRef(null);

  // New professional 3D platform state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showNPCPanel, setShowNPCPanel] = useState(false);
  const [showWorldBuilder, setShowWorldBuilder] = useState(false);
  const [timelineState, setTimelineState] = useState({
    currentFrame: 0,
    totalFrames: 250,
    fps: 30,
    isPlaying: false
  });
  const [gizmoMode, setGizmoMode] = useState('translate'); // translate, rotate, scale
  const [gizmoConstrainAxis, setGizmoConstrainAxis] = useState(null); // null, 'x', 'y', 'z'

  // Material Library
  const materialLibraryRef = useRef(new MaterialLibrary());
  const [selectedObjectForMaterial, setSelectedObjectForMaterial] = useState(null);


  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Mode switching (Tab)
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        setCurrentMode(currentMode === 'object' ? 'edit' : 'object');
      }

      // Tool shortcuts
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        setActiveTool('move');
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setActiveTool('rotate');
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setActiveTool('scale');
      }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        setActiveTool('select');
      }

      // Extrude (only in edit mode)
      if ((e.key === 'e' || e.key === 'E') && currentMode === 'edit') {
        e.preventDefault();
        setActiveTool('extrude');
      }

      // Delete
      if (e.key === 'x' || e.key === 'X' || e.key === 'Delete') {
        e.preventDefault();
        console.log('Delete action triggered');
      }

      // Add menu (Shift+A)
      if (e.key === 'a' && e.shiftKey) {
        e.preventDefault();
        console.log('Add menu triggered');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentMode]);

  // Context menu handler
  const handleContextMenu = useCallback((e) => {
    // Only show context menu in the 3D viewport area
    const viewportElement = e.target.closest('[data-viewport]');
    if (viewportElement) {
      e.preventDefault();
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
      });
    }
  }, []);

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  const handleMenuAction = (actionId) => {
    console.log('Menu action:', actionId);

    // Handle menu actions
    switch (actionId) {
      case 'file.save':
      case 'save':
        handleSaveProject();
        break;
      case 'file.load':
      case 'open':
        handleLoadProject();
        break;
      case 'file.export.obj':
      case 'export-obj':
        handleExport('obj');
        break;
      case 'file.export.stl':
      case 'export-stl':
        handleExport('stl');
        break;
      case 'file.export.gltf':
      case 'export-gltf':
        handleExport('gltf');
        break;
      case 'edit.settings':
        setIsSettingsOpen(true);
        break;
      case 'create.npc_crowd':
        setShowNPCPanel(true);
        setShowWorldBuilder(false);
        break;
      case 'create.procedural_world':
        setShowWorldBuilder(true);
        setShowNPCPanel(false);
        break;
      case 'view.timeline':
        setShowTimeline(!showTimeline);
        break;

      // Add > Primitives menu actions
      case 'add-cube':
        handleAddPrimitive('box', { width: 2, height: 2, depth: 2 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-sphere':
        handleAddPrimitive('sphere', { radius: 1 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-icosphere':
        handleAddPrimitive('sphere', { radius: 1, detail: 2 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-plane':
        handleAddPrimitive('plane', { width: 2, height: 2 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-cylinder':
        handleAddPrimitive('cylinder', { radiusTop: 0.5, radiusBottom: 0.5, height: 2 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-cone':
        handleAddPrimitive('cylinder', { radiusTop: 0, radiusBottom: 1, height: 2 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-torus':
        handleAddPrimitive('torus', { radius: 1, tube: 0.4 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-grid':
        handleAddPrimitive('plane', { width: 10, height: 10, segments: 10 }, sceneManagerRef.current, setModelData);
        break;
      case 'add-monkey':
        // Monkey head is a special mesh - for now use icosphere as placeholder
        handleAddPrimitive('sphere', { radius: 1, detail: 3 }, sceneManagerRef.current, setModelData);
        break;

      default:
        console.log('Unhandled menu action:', actionId);
    }
  };

  /**
   * Handle applying material to selected object
   */
  const handleApplyMaterial = (material) => {
    if (!sceneManagerRef.current || !selectedObjectForMaterial) {
      console.warn('⚠️ No object selected for material application');
      return;
    }

    console.log(`🎨 Applying material "${material.name}" to object`);

    // Apply material via MaterialLibrary
    const updatedObject = materialLibraryRef.current.applyMaterialToSceneObject(
      sceneManagerRef.current,
      selectedObjectForMaterial,
      material.id
    );

    if (updatedObject) {
      // Trigger scene refresh
      setModelData({
        type: 'material_applied',
        objectId: selectedObjectForMaterial,
        materialId: material.id,
        timestamp: Date.now()
      });

      console.log(`✅ Material "${material.name}" applied successfully`);
    }
  };

  const handleContextAction = (actionId) => {
    console.log('Context action:', actionId);
    // Handle context menu actions here
  };

  /**
   * Check if a prompt is for scene composition (environment generation)
   */
  const isSceneCompositionPrompt = (prompt) => {
    const lowerPrompt = prompt.toLowerCase();

    // Scene action keywords - expanded to include "recreate"
    const actionKeywords = ['create', 'generate', 'build', 'make', 'design', 'recreate', 'rebuild', 'construct'];
    const hasAction = actionKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Environment keywords (from scene templates) - EXPANDED with locations
    const environmentKeywords = [
      // Cities and urban
      'city', 'futuristic', 'urban', 'metropolis', 'cityscape', 'downtown', 'skyline',
      'manhattan', 'chicago', 'tokyo', 'london', 'paris', 'dubai', 'singapore', 'district', 'neighborhood',
      // Villages and settlements
      'village', 'medieval', 'town', 'settlement', 'hamlet', 'colony',
      // Industrial
      'industrial', 'factory', 'warehouse', 'manufacturing', 'complex',
      // Nature
      'landscape', 'nature', 'forest', 'wilderness', 'natural', 'terrain', 'environment',
      // Coastal
      'coastal', 'beach', 'ocean', 'seaside', 'harbor', 'shore', 'waterfront', 'bay', 'port',
      // Desert
      'desert', 'arid', 'sand', 'dunes', 'outpost', 'oasis',
      // Parks
      'park', 'garden', 'green space', 'plaza', 'square',
      // Space
      'space', 'station', 'orbital', 'spacecraft',
      // Architecture/structures
      'street', 'avenue', 'boulevard', 'buildings', 'skyscrapers', 'towers', 'blocks'
    ];
    const hasEnvironment = environmentKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Qualifiers that suggest environment (not single object)
    const environmentQualifiers = ['entire', 'whole', 'complete', 'full', 'scene', 'environment', 'area', 'district'];
    const hasQualifier = environmentQualifiers.some(keyword => lowerPrompt.includes(keyword));

    // It's a scene composition prompt if it has action + environment, or action + qualifier
    return hasAction && (hasEnvironment || hasQualifier);
  };

  /**
   * Handle scene composition via Scene Composer
   */
  const handleSceneComposition = async (prompt) => {
    console.log('🎨 Handling scene composition prompt:', prompt);
    console.log('🎯 Scene Composer will call AI backend (NO templates)');

    if (!environmentSystemRef.current || !environmentSystemRef.current.sceneComposer) {
      console.error('Scene Composer not initialized');
      setError('Scene Composer system is not ready. Please wait and try again.');
      return false;
    }

    try {
      setLoading(true);
      setError(null);
      setGenerationProgress({ status: 'processing', progress: 0.1, stages: ['Initializing scene generation...'] });

      const sceneComposer = environmentSystemRef.current.sceneComposer;

      console.log('📡 Calling Scene Composer AI generation...');

      // Generate scene with progress updates
      const scene = await sceneComposer.generateSceneFromPrompt(prompt, (progressInfo) => {
        setGenerationProgress({
          status: 'processing',
          progress: progressInfo.progress || 0.5,
          stages: [progressInfo.stage || 'Generating...']
        });
      });

      console.log(`✅ Scene composed: ${scene.assets.length} assets created`);
      console.log('✅ Scene generation used AI:', scene.aiGenerated || scene.template === 'ai_generated');

      // The scene objects are already added to the scene manager by the composer
      // Just trigger a refresh by updating model data
      // Use scene.seed as timestamp since it's unique per generation and won't change on re-renders
      setModelData({
        prompt: prompt,
        sceneType: 'environment_composition',
        template: scene.template,
        theme: scene.theme,
        assetCount: scene.assets.length,
        seed: scene.seed,
        timestamp: scene.seed, // Use seed as stable timestamp
        aiGenerated: scene.aiGenerated || scene.template === 'ai_generated',
      });

      setDesigns(prevDesigns => [...prevDesigns, {
        id: `scene_${Date.now()}`,
        prompt: prompt,
        sceneData: scene,
        timestamp: Date.now(),
      }]);

      return true;
    } catch (err) {
      console.error('❌ Scene composition failed:', err);
      setError(`Failed to generate scene: ${err.message}. Please check API configuration.`);
      return false;
    } finally {
      setLoading(false);
      setGenerationProgress(null);
    }
  };

  const handleGenerateDesign = async (prompt) => {
    console.log('🎯 Prompt routing decision:');
    console.log('  Prompt:', prompt);
    console.log('  Orchestrator enabled:', import.meta.env.VITE_ENABLE_ORCHESTRATOR);

    // Check if this is a scene composition prompt
    const isScenePrompt = isSceneCompositionPrompt(prompt);
    console.log('  Is scene composition:', isScenePrompt);

    if (isScenePrompt) {
      console.log('  Endpoint: SceneComposer → /api/generate (AI-powered)');
      console.log('  Using templates: false (AI-only mode)');
      const success = await handleSceneComposition(prompt);
      if (success) return; // Scene composition handled, don't call API
    } else {
      console.log('  Endpoint: Direct → /api/generate (single object)');
    }

    // Otherwise, use the regular API-based generation
    setLoading(true);
    setError(null);
    setGenerationProgress(null);
    setVariants([]); // Clear previous variants

    try {
      // Determine which generation mode to use
      const isFantasyMode = generationMode === 'fantasy';
      const generationAPI = isFantasyMode ? 'generateFantasyVariants' : 'generateVariants';

      console.log(`🎨 Attempting ${isFantasyMode ? 'fantasy' : 'realistic'} multi-variant generation...`);
      setGenerationProgress({
        status: 'processing',
        progress: 0.1,
        stages: [isFantasyMode ? 'Generating fantasy variants with Nano Banana Pro...' : 'Generating ultra-realistic variants...']
      });

      const variantResult = await apiService[generationAPI](prompt);

      if (variantResult.success && variantResult.variants && variantResult.variants.length > 0) {
        console.log(`✅ ${isFantasyMode ? 'Fantasy' : 'Realistic'} multi-variant generation succeeded: ${variantResult.variants.length} variants`);

        // Set variants
        setVariants(variantResult.variants);
        setSelectedVariant(0); // Select first variant by default

        // Convert first variant to modelData format
        const firstVariant = variantResult.variants[0];
        const modelDataFromVariant = convertVariantToModelData(firstVariant, prompt, isFantasyMode);
        setModelData(modelDataFromVariant);

        // Create a design object from the variant
        const variantDesign = {
          specifications: {
            name: firstVariant.name,
            description: firstVariant.description,
            dimensions: firstVariant.dimensions,
            materials: firstVariant.materials,
            elements: firstVariant.elements,
            complexity: firstVariant.metadata?.complexity || 'medium',
          },
          model: modelDataFromVariant,
          id: `variant_${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        setDesign(variantDesign);

        // Add to designs array
        setDesigns(prevDesigns => [...prevDesigns, {
          id: `design_${Date.now()}`,
          prompt: prompt,
          design: variantDesign,
          modelData: modelDataFromVariant,
          variants: variantResult.variants,
          timestamp: Date.now(),
        }]);

        setGenerationProgress({ status: 'completed', progress: 1.0, stages: ['Variants generated successfully!'] });

        // Log real-world data if available
        if (variantResult.realWorldData) {
          console.log('📚 Real-world reference data:', variantResult.realWorldData);
        }

        return; // Success - don't fall back to standard generation
      } else {
        console.warn('⚠️  Multi-variant generation returned no results, falling back to standard generation');
      }
    } catch (variantError) {
      console.warn('⚠️  Multi-variant generation failed, falling back to standard generation:', variantError.message);
      // Fall through to standard generation
    }

    // Fallback to standard generation if variants failed
    try {
      setGenerationProgress({ status: 'processing', progress: 0.1, stages: ['Generating design...'] });

      // Generate design with progress tracking
      const result = await apiService.generateDesign(prompt, (progress) => {
        setGenerationProgress(progress);
        console.log('Generation progress:', progress);
      });

      if (result.success && result.design) {
        setDesign(result.design);

        // Add prompt to model data so we can track it
        const modelDataWithPrompt = {
          ...result.modelData,
          prompt: prompt,
        };
        setModelData(modelDataWithPrompt);

        // Add to designs array instead of replacing
        setDesigns(prevDesigns => [...prevDesigns, {
          id: `design_${Date.now()}`,
          prompt: prompt,
          design: result.design,
          modelData: result.modelData,
          timestamp: Date.now(),
        }]);

        // Optionally perform analysis and compliance checks
        if (result.design.specifications) {
          try {
            const analysisResult = await apiService.analyzeDesign(result.design.specifications);
            setAnalysis(analysisResult.analysis);
          } catch (err) {
            console.warn('Analysis failed:', err);
          }

          try {
            const complianceResult = await apiService.checkCompliance(result.design.specifications);
            setCompliance(complianceResult.compliance);
          } catch (err) {
            console.warn('Compliance check failed:', err);
          }
        }
      } else {
        throw new Error(
          'AI pipeline failed to generate design. Please check:\n' +
          '1. GEMINI_API_KEY is configured in backend\n' +
          '2. Backend services are running (npm start in backend/)\n' +
          '3. API has not hit rate limits\n' +
          '4. Prompt is clear and specific\n\n' +
          'Check backend logs for detailed failure information.\n' +
          'NO TEMPLATE FALLBACKS AVAILABLE - all generation requires AI.'
        );
      }
    } catch (err) {
      setError('Failed to generate design. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
      setGenerationProgress(null);
      setCurrentJobId(null);
    }
  };

  const handleCancelGeneration = async () => {
    if (currentJobId) {
      try {
        await apiService.cancelJob(currentJobId);
        setLoading(false);
        setGenerationProgress(null);
        setCurrentJobId(null);
        setError('Generation cancelled');
      } catch (err) {
        console.error('Failed to cancel job:', err);
      }
    }
  };

  /**
   * Convert variant to modelData format for 3D viewer
   */
  const convertVariantToModelData = (variant, prompt, isFantasyMode = false) => {
    return {
      prompt: prompt,
      variantStyle: variant.style,
      variantTitle: variant.title,
      fantasyMode: isFantasyMode || variant.fantasyMode || false,
      conceptImage: variant.conceptImage || null,
      imageDescription: variant.imageDescription || null,
      geometry: {
        type: 'custom',
        dimensions: variant.dimensions,
      },
      materials: variant.materials || [],
      elements: variant.elements || [],
      metadata: {
        ...variant.metadata,
        name: variant.name,
        description: variant.description,
        generationMode: isFantasyMode ? 'fantasy' : 'realistic',
      },
      timestamp: Date.now(),
    };
  };

  /**
   * Handle variant selection
   */
  const handleVariantSelect = (variantIndex) => {
    if (!variants || variantIndex >= variants.length) return;

    console.log(`🎨 Switching to variant ${variantIndex + 1}: ${variants[variantIndex].title}`);
    setSelectedVariant(variantIndex);

    // Update modelData to reflect selected variant
    const selectedVariantData = variants[variantIndex];
    const isFantasyMode = selectedVariantData.fantasyMode || generationMode === 'fantasy';
    const modelDataFromVariant = convertVariantToModelData(
      selectedVariantData,
      modelData?.prompt || 'Unknown prompt',
      isFantasyMode
    );
    setModelData(modelDataFromVariant);

    // Update design object
    const variantDesign = {
      specifications: {
        name: selectedVariantData.name,
        description: selectedVariantData.description,
        dimensions: selectedVariantData.dimensions,
        materials: selectedVariantData.materials,
        elements: selectedVariantData.elements,
        complexity: selectedVariantData.metadata?.complexity || 'medium',
      },
      model: modelDataFromVariant,
      id: `variant_${Date.now()}_${variantIndex}`,
      createdAt: new Date().toISOString(),
    };
    setDesign(variantDesign);
  };

  /**
   * Handle creating 3D design from selected variant
   * This will trigger the actual 3D model generation using the selected variant data
   */
  const handleCreateDesign = async () => {
    if (!variants || !variants[selectedVariant]) {
      console.error('No variant selected');
      return;
    }

    setIsCreatingDesign(true);
    setLoading(true); // Show the main loading overlay
    setError(null);

    try {
      const selectedVariantData = variants[selectedVariant];
      console.log('🎯 Creating 3D design from variant:', selectedVariantData.title);

      setGenerationProgress({
        status: 'processing',
        progress: 0.1,
        stages: ['Initializing generation pipeline...']
      });

      // Construct detailed prompt from variant
      let detailedPrompt = `${selectedVariantData.title}: ${selectedVariantData.description}. Style: ${selectedVariantData.style}.`;
      if (selectedVariantData.details?.structuralFeatures) {
        detailedPrompt += ` Details: ${selectedVariantData.details.structuralFeatures.join(', ')}.`;
      }

      console.log('🚀 Triggering backend generation with prompt:', detailedPrompt);

      // Call the real backend generation pipeline
      const result = await apiService.generateDesign(detailedPrompt, (progress) => {
        // Map backend progress to frontend state
        setGenerationProgress({
          status: 'processing',
          progress: (progress.progress || 0) / 100,
          stages: [progress.stages?.current || 'Generating...']
        });
      });

      if (result && result.success && result.modelData) {
        console.log('✅ Backend generation successful, received modelData:', result.modelData);

        setGenerationProgress({ status: 'completed', progress: 1.0, stages: ['3D design created successfully!'] });

        // Pass the generated model data to the workbench
        const realModelData = {
          ...result.modelData,
          name: selectedVariantData.title,
          prompt: detailedPrompt,
          position: { x: 0, y: 0, z: 0 }
        };

        setModelData(realModelData);
        setShowWorkbench(true);

        console.log('✅ 3D design created and loaded into workbench');

        // Close variants panel immediately to show the result
        setVariants([]);
      } else {
        throw new Error('Generation completed but returned no model data');
      }

    } catch (error) {
      console.error('❌ Failed to create 3D design:', error);
      setError('Failed to create 3D design. Please try again.');
    } finally {
      setIsCreatingDesign(false);
      setLoading(false); // Hide loading overlay
      setGenerationProgress(null); // Clear progress
    }
  };

  const handleSaveProject = () => {
    if (sceneManagerRef.current) {
      saveProject(sceneManagerRef.current);
    }
  };

  const handleLoadProject = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.archdisc,.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (sceneManagerRef.current && loadProject(event.target.result, sceneManagerRef.current)) {
            setError(null);
          } else {
            setError('Failed to load project file.');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleExport = (format) => {
    if (!sceneManagerRef.current) return;

    try {
      switch (format) {
        case 'obj':
          exportToOBJ(sceneManagerRef.current);
          break;
        case 'stl':
          exportToSTL(sceneManagerRef.current);
          break;
        case 'gltf':
          exportToGLTF(sceneManagerRef.current);
          break;
        case 'glb':
          exportToGLTF(sceneManagerRef.current, true);
          break;
        default:
          console.error('Unknown export format:', format);
      }
    } catch (err) {
      setError(`Failed to export as ${format.toUpperCase()}`);
      console.error(err);
    }
  };

  const handleUndo = () => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.undo();
    }
  };

  const handleRedo = () => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.redo();
    }
  };

  const canUndo = sceneManagerRef.current ? sceneManagerRef.current.canUndo() : false;
  const canRedo = sceneManagerRef.current ? sceneManagerRef.current.canRedo() : false;

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
    }}>

      {/* Top Branding Bar */}
      <header style={{
        height: '36px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h1 style={{
            fontSize: '14px',
            fontWeight: 'bold',
            color: 'var(--text-primary)',
            margin: 0,
          }}>
            ArchDisc
          </h1>
          <div style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            padding: '2px 8px',
            background: 'var(--bg-tertiary)',
            borderRadius: '10px',
          }}>
            AI-Powered Design Workbench
          </div>
        </div>

        {/* AI Status Indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: 'var(--bg-tertiary)',
          borderRadius: '4px',
          fontSize: '11px',
          color: 'var(--text-secondary)',
        }}>
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: loading ? 'var(--accent-orange)' : '#4caf50',
          }} />
          <span>{loading ? 'Generating...' : 'AI Ready'}</span>
        </div>
      </header>

      {/* Menu Bar */}
      <MenuBar onMenuAction={handleMenuAction} />

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '12px 20px',
          background: '#f44336',
          color: 'white',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '18px',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: sidebarCollapsed
          ? (rightPanelCollapsed ? '0px 1fr 0px' : '0px 1fr 240px')
          : (rightPanelCollapsed ? '160px 1fr 0px' : '160px 1fr 240px'),
        overflow: 'hidden',
        transition: 'grid-template-columns 0.3s ease',
      }}>
        {/* Left Sidebar - Tools (Retractable) */}
        <div style={{
          borderRight: sidebarCollapsed ? 'none' : '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-primary)',
          overflow: 'visible',
          position: 'relative',
        }}>
          {!sidebarCollapsed && (
            <div style={{
              height: '100%',
              overflow: 'hidden',
              width: '160px',
            }}>
              <AdvancedToolbar
                activeTool={activeTool}
                onToolSelect={setActiveTool}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={canUndo}
                canRedo={canRedo}
              />
            </div>
          )}

          {/* Toggle button - Always visible */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              position: 'absolute',
              right: sidebarCollapsed ? '-80px' : '-10px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: sidebarCollapsed ? '80px' : '24px',
              height: '50px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '0 6px 6px 0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              fontSize: sidebarCollapsed ? '11px' : '12px',
              zIndex: 100,
              boxShadow: '2px 0 8px rgba(0,0,0,0.2)',
              transition: 'all 0.3s ease',
              padding: '0 8px',
              textAlign: 'center',
              lineHeight: '1.2',
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'var(--accent-orange)';
              e.target.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'var(--bg-secondary)';
              e.target.style.color = 'var(--text-secondary)';
            }}
          >
            {sidebarCollapsed ? 'Tools' : '◀'}
          </button>
        </div>

        {/* Center - 3D Viewer */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}>

          {/* Toolbar */}
          <Toolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            isExploded={isExploded}
            onExplodeToggle={() => setIsExploded(!isExploded)}
            currentMode={currentMode}
            onModeChange={setCurrentMode}
            activeTool={activeTool}
            onToolChange={setActiveTool}
            showGrid={showGrid}
            onGridToggle={() => setShowGrid(!showGrid)}
            showSnap={showSnap}
            onSnapToggle={() => setShowSnap(!showSnap)}
          />

          {/* 3D Viewer - fills remaining space */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {/* Loading overlay - shown on top of AdvancedWorkbench */}
            {loading && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
              }}>
                <div className="spinner" style={{
                  width: '48px',
                  height: '48px',
                  borderWidth: '4px',
                  marginBottom: '20px',
                }} />
                <div style={{ fontSize: '18px', marginBottom: '10px' }}>
                  Generating your design...
                </div>
                {generationProgress && (
                  <>
                    <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                      {getStageLabel(generationProgress.status)} - {generationProgress.progress}%
                    </div>
                    {/* Progress bar */}
                    <div style={{
                      width: '300px',
                      height: '6px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      marginBottom: '15px',
                    }}>
                      <div style={{
                        width: `${generationProgress.progress}%`,
                        height: '100%',
                        background: 'var(--accent-orange)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    {/* Stage breakdown */}
                    {generationProgress.stages && (
                      <div style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        gap: '15px',
                        marginBottom: '15px',
                      }}>
                        {Object.entries(generationProgress.stages).map(([stage, info]) => (
                          <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: info.status === 'completed' ? '#4caf50' :
                                info.status === 'in_progress' ? 'var(--accent-orange)' :
                                  '#666',
                            }} />
                            <span>{stage}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <button
                  onClick={handleCancelGeneration}
                  style={{
                    marginTop: '10px',
                    padding: '8px 16px',
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = '#f44336';
                    e.target.style.color = 'white';
                    e.target.style.borderColor = '#f44336';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'transparent';
                    e.target.style.color = 'var(--text-secondary)';
                    e.target.style.borderColor = 'var(--border-color)';
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            {/* AdvancedWorkbench - always mounted to preserve SceneManager instance */}
            <AdvancedWorkbench
              activeTool={activeTool}
              onToolChange={setActiveTool}
              viewMode={viewMode}
              modelData={modelData}
              onSceneUpdate={(info) => {
                setSceneInfo(info);
                if (info.sceneManager) {
                  sceneManagerRef.current = info.sceneManager;
                }
                if (info.environmentSystem) {
                  environmentSystemRef.current = info.environmentSystem;
                }
              }}
            />
          </div>

          {/* Status Bar - overlays at bottom */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 }}>
            <StatusBar
              mode={currentMode === 'object' ? 'Object Mode' : currentMode === 'edit' ? 'Edit Mode' : 'Sculpt Mode'}
              activeTool={activeTool}
              selectionCount={selectionCount}
              stats={{ triangles: 0, fps: 60 }}
            />
          </div>
        </div>

        {/* Right - Sidebar (Enhanced Properties Panel) */}
        <Sidebar
          design={design}
          analysis={analysis}
          compliance={compliance}
          currentMode={currentMode}
          activeTool={activeTool}
          selectedObjects={selectedObjects}
        />
      </div>

      {/* Context Menu */}
      <ContextMenu
        visible={contextMenu.visible}
        position={{ x: contextMenu.x, y: contextMenu.y }}
        currentMode={currentMode}
        onClose={() => setContextMenu({ ...contextMenu, visible: false })}
        onAction={handleContextAction}
      />

      {/* Bottom Prompt Bar - Floating over canvas - Hidden when variants are showing */}
      {(!variants || variants.length === 0) && (
        <BottomPromptBar onSubmit={handleGenerateDesign} loading={loading} />
      )}

      {/* Variant Selector - Display design variants (Phase 1) */}
      {variants && variants.length > 0 && (
        <VariantSelector
          variants={variants}
          selectedVariant={selectedVariant}
          onVariantSelect={handleVariantSelect}
          onCreateDesign={handleCreateDesign}
          isCreating={isCreatingDesign}
        />
      )}

      {/* Timeline Editor - Cinema 4D/Blender style timeline at bottom */}
      {showTimeline && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: '25vh', zIndex: 100 }}>
          <TimelineEditor
            sceneManager={sceneManagerRef.current}
            currentFrame={timelineState.currentFrame}
            totalFrames={timelineState.totalFrames}
            fps={timelineState.fps}
            isPlaying={timelineState.isPlaying}
            onFrameChange={(frame) => setTimelineState(prev => ({ ...prev, currentFrame: frame }))}
            onPlayPause={() => setTimelineState(prev => ({ ...prev, isPlaying: !prev.isPlaying }))}
          />
        </div>
      )}

      {/* Project Settings Modal */}
      {isSettingsOpen && (
        <ProjectSettings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          sceneManager={sceneManagerRef.current}
        />
      )}

      {/* NPC Crowd Panel - Side panel for crowd generation */}
      {showNPCPanel && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: '72px',
          bottom: showTimeline ? '25vh' : 0,
          width: '400px',
          zIndex: 90,
          background: '#1a1a1a',
          borderLeft: '1px solid #333',
          boxShadow: '-4px 0 12px rgba(0,0,0,0.3)'
        }}>
          <NPCCrowdPanel
            sceneManager={sceneManagerRef.current}
            onCrowdGenerated={(crowd) => {
              console.log('Crowd generated:', crowd);
              // Could add NPCs to scene here
            }}
            onClose={() => setShowNPCPanel(false)}
          />
        </div>
      )}

      {/* Procedural World Builder Panel */}
      {showWorldBuilder && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: '72px',
          bottom: showTimeline ? '25vh' : 0,
          width: '400px',
          zIndex: 90,
          background: '#1a1a1a',
          borderLeft: '1px solid #333',
          boxShadow: '-4px 0 12px rgba(0,0,0,0.3)'
        }}>
          <ProceduralWorldBuilder
            sceneManager={sceneManagerRef.current}
            onWorldGenerated={(world) => {
              console.log('World generated:', world);
              // Could add world to scene here
            }}
            onClose={() => setShowWorldBuilder(false)}
          />
        </div>
      )}

      {/* Help Panel */}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// Helper function to get user-friendly stage labels
function getStageLabel(status) {
  const labels = {
    analyzing: 'Analyzing Prompt',
    generating: 'Generating Geometry',
    refining: 'Refining Model',
    exporting: 'Preparing Exports',
    queued: 'Queued',
    processing: 'Processing',
  };
  return labels[status] || status;
}

export default App;
