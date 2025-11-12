import { useState, useEffect, useCallback } from 'react';
import BottomPromptBar from './components/BottomPromptBar';
import WorkbenchViewer from './components/WorkbenchViewer';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import MenuBar from './components/MenuBar';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
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

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
    }}>
      {/* Header - Compact */}
      <header style={{
        padding: '6px 16px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h1 style={{
            fontSize: '13px',
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
        
        {/* Status indicator */}
        <div style={{
          fontSize: '10px',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <div style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: loading ? 'var(--accent-orange)' : '#4caf50',
          }} />
          {loading ? 'Generating...' : 'Ready'}
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
        overflow: 'hidden',
      }}>
        {/* Left - 3D Viewer */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border-color)',
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
          
          {/* 3D Viewer */}
          <div style={{ flex: 1, position: 'relative' }} data-viewport="true">
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
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  This may take a few moments
                </div>
              </div>
            ) : (
              <WorkbenchViewer 
                modelData={design?.model}
                viewMode={viewMode}
                isExploded={isExploded}
              />
            )}
          </div>

          {/* Status Bar */}
          <StatusBar
            mode={currentMode === 'object' ? 'Object Mode' : currentMode === 'edit' ? 'Edit Mode' : 'Sculpt Mode'}
            activeTool={activeTool}
            selectionCount={selectionCount}
            stats={{ triangles: 0, fps: 60 }}
          />
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

      {/* Bottom Prompt Bar - Floating */}
      <BottomPromptBar onSubmit={handleGenerateDesign} loading={loading} />
    </div>
  );
}

export default App;
