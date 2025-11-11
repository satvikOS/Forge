import { useState } from 'react';
import BottomPromptBar from './components/BottomPromptBar';
import WorkbenchViewer from './components/WorkbenchViewer';
import PropertiesPanel from './components/PropertiesPanel';
import Toolbar from './components/Toolbar';
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
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false); // Start expanded

  const handleGenerateDesign = async (prompt) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setCompliance(null);

    try {
      // Generate design
      const designResult = await apiService.generateDesign(prompt);
      setDesign(designResult.design);
      
      // Auto-expand panel when design is generated
      setIsPanelCollapsed(false);

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
            fontSize: '20px',
            fontWeight: '400',
            color: 'var(--text-primary)',
            margin: 0,
          }}>
            ArchDisc
          </h1>
          <div style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            padding: '3px 8px',
            background: 'var(--bg-tertiary)',
            borderRadius: '10px',
            fontWeight: '300',
          }}>
            AI-Powered Design Workbench
          </div>
        </div>
        
        {/* AI Online Indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: loading ? '#f44336' : '#4caf50',
            boxShadow: loading ? '0 0 8px rgba(244, 67, 54, 0.6)' : '0 0 8px rgba(76, 175, 80, 0.6)',
            transition: 'all 0.3s ease',
          }} />
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
        gridTemplateColumns: isPanelCollapsed ? '1fr 50px' : '1fr 350px',
        overflow: 'hidden',
        transition: 'grid-template-columns 0.3s ease',
      }}>
        {/* Left - 3D Viewer */}
        <div style={{
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
          />
          
          {/* 3D Viewer */}
          <div style={{ flex: 1, position: 'relative' }}>
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
            )}
          </div>
        </div>

        {/* Right - Properties Panel */}
        <PropertiesPanel 
          design={design}
          analysis={analysis}
          compliance={compliance}
          isCollapsed={isPanelCollapsed}
          onToggleCollapse={() => setIsPanelCollapsed(!isPanelCollapsed)}
        />
      </div>

      {/* Bottom Prompt Bar - Now Floating */}
      <BottomPromptBar onSubmit={handleGenerateDesign} loading={loading} />
    </div>
  );
}

export default App;
