import { useState, useRef } from 'react';
import BottomPromptBar from './components/BottomPromptBar';
import WorkbenchViewer from './components/WorkbenchViewer';
import AdvancedWorkbench from './components/AdvancedWorkbench';
import PropertiesPanel from './components/PropertiesPanel';
import Toolbar from './components/Toolbar';
import AdvancedToolbar from './components/AdvancedToolbar';
import SceneHierarchyPanel from './components/SceneHierarchyPanel';
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
  const [mode, setMode] = useState('advanced'); // 'simple' or 'advanced'
  const [activeTool, setActiveTool] = useState('select');
  const [sceneInfo, setSceneInfo] = useState({ selectedCount: 0, totalObjects: 0 });
  const sceneManagerRef = useRef(null);
  const [selectedObjects, setSelectedObjects] = useState(new Set());

  const handleGenerateDesign = async (prompt) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setCompliance(null);

    try {
      // Generate design
      const designResult = await apiService.generateDesign(prompt);
      setDesign(designResult.design);

      // Perform analysis
      const analysisResult = await apiService.analyzeDesign(designResult.design.specifications);
      setAnalysis(analysisResult.analysis);

      // Check compliance
      const complianceResult = await apiService.checkCompliance(designResult.design.specifications);
      setCompliance(complianceResult.compliance);
    } catch (err) {
      setError('Failed to generate design. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
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
      {/* Header */}
      <header style={{
        padding: '15px 20px',
        background: 'var(--bg-secondary)',
        borderBottom: '2px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h1 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: 'var(--text-primary)',
            margin: 0,
          }}>
            ArchDisc
          </h1>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            padding: '4px 10px',
            background: 'var(--bg-tertiary)',
            borderRadius: '12px',
          }}>
            AI-Powered Design Workbench
          </div>
          
          {/* Mode Toggle */}
          <div style={{
            display: 'flex',
            gap: '4px',
            background: 'var(--bg-tertiary)',
            borderRadius: '8px',
            padding: '4px',
          }}>
            <button
              onClick={() => setMode('simple')}
              style={{
                padding: '6px 12px',
                background: mode === 'simple' ? 'var(--accent-orange)' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: mode === 'simple' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: mode === 'simple' ? 'bold' : 'normal',
              }}
            >
              AI Mode
            </button>
            <button
              onClick={() => setMode('advanced')}
              style={{
                padding: '6px 12px',
                background: mode === 'advanced' ? 'var(--accent-orange)' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: mode === 'advanced' ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: mode === 'advanced' ? 'bold' : 'normal',
              }}
            >
              3D Editor
            </button>
          </div>
        </div>
        
        {/* File Menu */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {mode === 'advanced' && (
            <>
              <button
                onClick={handleSaveProject}
                style={{
                  padding: '6px 12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
                title="Save Project"
              >
                💾 Save
              </button>
              <button
                onClick={handleLoadProject}
                style={{
                  padding: '6px 12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
                title="Load Project"
              >
                📁 Load
              </button>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                  onClick={(e) => {
                    const menu = e.target.nextSibling;
                    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                  }}
                  title="Export"
                >
                  📤 Export
                </button>
                <div style={{
                  display: 'none',
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '4px',
                  zIndex: 1000,
                  minWidth: '120px',
                }}>
                  {['obj', 'stl', 'gltf', 'glb'].map(format => (
                    <button
                      key={format}
                      onClick={() => {
                        handleExport(format);
                        document.activeElement.blur();
                      }}
                      style={{
                        width: '100%',
                        padding: '6px 12px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          
          {/* Status indicator */}
          <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginLeft: '8px',
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: loading ? 'var(--accent-orange)' : '#4caf50',
            }} />
            {loading ? 'Generating...' : 'Ready'}
          </div>
        </div>
      </header>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '12px 20px',
          background: '#f44336',
          color: 'white',
          fontSize: '14px',
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
        gridTemplateColumns: mode === 'advanced' ? '250px 1fr 350px' : '1fr 350px',
        overflow: 'hidden',
      }}>
        {/* Left Sidebar - Scene Hierarchy (Advanced Mode Only) */}
        {mode === 'advanced' && sceneManagerRef.current && (
          <div style={{
            borderRight: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <SceneHierarchyPanel
              sceneManager={sceneManagerRef.current}
              selectedObjects={selectedObjects}
              onObjectSelect={(id) => {
                if (sceneManagerRef.current) {
                  sceneManagerRef.current.selectObject(id, 'toggle');
                  setSelectedObjects(new Set(sceneManagerRef.current.selectedObjects));
                }
              }}
            />
          </div>
        )}

        {/* Center - 3D Viewer */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-color)',
        }}>
          {/* Toolbar */}
          {mode === 'advanced' ? (
            <div style={{ height: '60px', borderBottom: '1px solid var(--border-color)' }}>
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
          ) : (
            <Toolbar
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              isExploded={isExploded}
              onExplodeToggle={() => setIsExploded(!isExploded)}
            />
          )}
          
          {/* 3D Viewer */}
          <div style={{ flex: 1, position: 'relative' }}>
            {mode === 'simple' ? (
              loading ? (
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
                  <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    This may take a few moments
                  </div>
                </div>
              ) : (
                <WorkbenchViewer 
                  modelData={design?.model}
                  viewMode={viewMode}
                  isExploded={isExploded}
                />
              )
            ) : (
              <AdvancedWorkbench
                activeTool={activeTool}
                onToolChange={setActiveTool}
                viewMode={viewMode}
                onSceneUpdate={(info) => {
                  setSceneInfo(info);
                  if (info.sceneManager) {
                    sceneManagerRef.current = info.sceneManager;
                  }
                }}
              />
            )}
          </div>
        </div>

        {/* Right - Properties Panel */}
        <PropertiesPanel 
          design={design}
          analysis={analysis}
          compliance={compliance}
        />
      </div>

      {/* Bottom Prompt Bar - Only in Simple Mode */}
      {mode === 'simple' && (
        <div style={{ paddingBottom: '70px' }}>
          <BottomPromptBar onSubmit={handleGenerateDesign} loading={loading} />
        </div>
      )}
    </div>
  );
}

export default App;
