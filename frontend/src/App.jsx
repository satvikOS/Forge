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
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [proposals, setProposals] = useState([]);
  const [showProposals, setShowProposals] = useState(false);

  const handleGenerateDesign = async (prompt) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setCompliance(null);
    setShowProposals(false);

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

  const handleGenerateProposals = async (prompt) => {
    setLoading(true);
    setError(null);
    setShowProposals(false);

    try {
      const result = await apiService.generateProposals(prompt, 3);
      setProposals(result.proposals || []);
      setShowProposals(true);
    } catch (err) {
      setError('Failed to generate proposals. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectProposal = (proposal) => {
    setDesign(proposal);
    setShowProposals(false);
    // Run analysis and compliance check
    apiService.analyzeDesign(proposal.specifications).then(result => {
      setAnalysis(result.analysis);
    }).catch(console.error);
    apiService.checkCompliance(proposal.specifications).then(result => {
      setCompliance(result.compliance);
    }).catch(console.error);
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {/* Thin Professional Header */}
      <header style={{
        height: '48px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 15px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{
              fontSize: '18px',
              fontWeight: 'bold',
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
            }}>
              AI Design
            </div>
          </div>

          {/* Menu Bar */}
          <nav style={{ display: 'flex', gap: '5px' }}>
            {['File', 'Edit', 'View', 'Tools', 'Window', 'Help'].map((menu) => (
              <button
                key={menu}
                style={{
                  padding: '4px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  borderRadius: '4px',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--bg-hover)';
                  e.target.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'transparent';
                  e.target.style.color = 'var(--text-secondary)';
                }}
              >
                {menu}
              </button>
            ))}
          </nav>
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
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: loading ? 'var(--accent-orange)' : '#4caf50',
          }} />
          {loading ? 'Generating...' : 'Ready'}
        </div>
      </header>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '10px 20px',
          background: '#f44336',
          color: 'white',
          fontSize: '13px',
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

      {/* Main Canvas Area */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {/* Canvas with Toolbar */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Thin Toolbar */}
          <Toolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            isExploded={isExploded}
            onExplodeToggle={() => setIsExploded(!isExploded)}
          />
          
          {/* 3D Viewer - Full Screen */}
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
                  {showProposals ? 'Generating proposals...' : 'Generating your design...'}
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

        {/* Right Panel - Collapsible and Translucent */}
        {rightPanelOpen && (
          <div style={{
            width: '350px',
            background: 'rgba(26, 26, 26, 0.95)',
            backdropFilter: 'blur(10px)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            zIndex: 10,
          }}>
            <PropertiesPanel 
              design={design}
              analysis={analysis}
              compliance={compliance}
            />
          </div>
        )}

        {/* Panel Toggle Button */}
        <button
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          style={{
            position: 'absolute',
            right: rightPanelOpen ? '350px' : '0',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '24px',
            height: '60px',
            background: 'rgba(26, 26, 26, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRight: rightPanelOpen ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
            borderLeft: rightPanelOpen ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
            borderRadius: rightPanelOpen ? '6px 0 0 6px' : '0 6px 6px 0',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            zIndex: 11,
            transition: 'right 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'rgba(42, 42, 42, 0.95)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'rgba(26, 26, 26, 0.95)';
          }}
        >
          {rightPanelOpen ? '›' : '‹'}
        </button>
      </div>

      {/* Floating Prompt Bar */}
      <BottomPromptBar 
        onSubmit={handleGenerateDesign} 
        onGenerateProposals={handleGenerateProposals}
        loading={loading} 
      />

      {/* Proposals Modal */}
      {showProposals && proposals.length > 0 && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '12px',
            padding: '30px',
            maxWidth: '1200px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'auto',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}>
              <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>
                ArchPro Proposals
              </h2>
              <button
                onClick={() => setShowProposals(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '24px',
                }}
              >
                ×
              </button>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '20px',
            }}>
              {proposals.map((proposal, idx) => (
                <div
                  key={idx}
                  onClick={() => selectProposal(proposal)}
                  style={{
                    background: 'var(--bg-tertiary)',
                    borderRadius: '8px',
                    padding: '20px',
                    cursor: 'pointer',
                    border: '2px solid transparent',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-orange)';
                    e.currentTarget.style.transform = 'translateY(-4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'transparent';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <h3 style={{ 
                    color: 'var(--accent-orange)', 
                    marginBottom: '10px',
                    fontSize: '16px',
                  }}>
                    {proposal.specifications.name || `Proposal ${idx + 1}`}
                  </h3>
                  <p style={{ 
                    color: 'var(--text-secondary)', 
                    fontSize: '13px',
                    marginBottom: '10px',
                  }}>
                    {proposal.specifications.description}
                  </p>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <div>Style: {proposal.specifications.style}</div>
                    <div>Type: {proposal.specifications.objectType}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
