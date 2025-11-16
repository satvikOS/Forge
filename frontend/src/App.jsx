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
import SceneManager from './systems/SceneManager';
import { saveProject, loadProject, exportToOBJ, exportToSTL, exportToGLTF } from './systems/FileExport';
import apiService from './services/api';
import './styles/index.css';

function App() {
  const [design, setDesign] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('solid');

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
    // Handle menu actions here
  };

  const handleContextAction = (actionId) => {
    console.log('Context action:', actionId);
    // Handle context menu actions here
  };

  const handleGenerateDesign = async (prompt) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setCompliance(null);
    setGenerationProgress(null);
    setModelData(null);

    try {
      // Generate design with progress tracking
      const result = await apiService.generateDesign(prompt, (progress) => {
        setGenerationProgress(progress);
        console.log('Generation progress:', progress);
      });
      
      if (result.success && result.design) {
        setDesign(result.design);
        setModelData(result.modelData);
        
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
        throw new Error('Generation completed but no design data received');
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

        display: 'flex',

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
            {loading ? (
              <div style={{
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
            ) : (
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
                }}
              />
            )}
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

      {/* Bottom Prompt Bar - Floating over canvas */}
      <BottomPromptBar onSubmit={handleGenerateDesign} loading={loading} />

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
