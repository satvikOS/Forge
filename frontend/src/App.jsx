import { useState } from 'react';
import Topbar from './components/Topbar';
import FloatingPromptBar from './components/FloatingPromptBar';
import Sidebar from './components/Sidebar';
import WorkbenchViewer from './components/WorkbenchViewer';
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
      overflow: 'hidden',
    }}>
      {/* Topbar */}
      <Topbar status="Ready" loading={loading} />

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
          zIndex: 100,
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

      {/* Main Content Area - Maximized Canvas Layout */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Toolbar */}
        <Toolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          isExploded={isExploded}
          onExplodeToggle={() => setIsExploded(!isExploded)}
        />
        
        {/* 3D Viewer - Full canvas coverage */}
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

      {/* Retractable Sidebar */}
      <Sidebar 
        design={design}
        analysis={analysis}
        compliance={compliance}
      />

      {/* Floating Prompt Bar */}
      <FloatingPromptBar onSubmit={handleGenerateDesign} loading={loading} />
    </div>
  );
}

export default App;
