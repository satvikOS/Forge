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
            fontSize: '14px',
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
        </div>
        
        {/* Status indicator */}
        <div style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: loading ? 'var(--accent-orange)' : '#4caf50',
          }} />
          {loading ? 'Generating...' : 'Ready'}
        </div>
      </header>

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
              fontSize: '12px',
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
        gridTemplateColumns: '1fr 350px',
        overflow: 'hidden',
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
                <div style={{ fontSize: '12px', marginBottom: '10px' }}>
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
        </div>

        {/* Right - Properties Panel */}
        <PropertiesPanel 
          design={design}
          analysis={analysis}
          compliance={compliance}
        />
      </div>

      {/* Bottom Prompt Bar */}
      <div style={{ paddingBottom: '70px' }}>
        <BottomPromptBar onSubmit={handleGenerateDesign} loading={loading} />
      </div>
    </div>
  );
}

export default App;
