import { useState } from 'react';
import PromptInput from './components/PromptInput';
import Viewer3D from './components/Viewer3D';
import DesignInfo from './components/DesignInfo';
import apiService from './services/api';
import './styles/index.css';

function App() {
  const [design, setDesign] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
      minHeight: '100vh',
      padding: '20px',
    }}>
      {/* Header */}
      <header style={{
        textAlign: 'center',
        marginBottom: '30px',
        color: 'white',
      }}>
        <h1 style={{
          fontSize: '48px',
          fontWeight: 'bold',
          marginBottom: '10px',
          textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
        }}>
          ArchDisc
        </h1>
        <p style={{
          fontSize: '18px',
          textShadow: '1px 1px 2px rgba(0,0,0,0.3)',
        }}>
          AI-Powered Design Platform - Create Anything from Cars to Buildings
        </p>
      </header>

      {/* Error Message */}
      {error && (
        <div style={{
          background: '#f44336',
          color: 'white',
          padding: '15px',
          borderRadius: '8px',
          marginBottom: '20px',
          textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      {/* Main Content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 2fr',
        gap: '20px',
        maxWidth: '1400px',
        margin: '0 auto',
      }}>
        {/* Left Panel - Input and Info */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}>
          <PromptInput onSubmit={handleGenerateDesign} loading={loading} />
          <DesignInfo design={design} analysis={analysis} compliance={compliance} />
        </div>

        {/* Right Panel - 3D Viewer */}
        <div style={{
          background: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          overflow: 'hidden',
          height: '700px',
        }}>
          {loading ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              background: '#1a1a2e',
              color: 'white',
              fontSize: '18px',
            }}>
              Generating your design...
            </div>
          ) : (
            <Viewer3D modelData={design?.model} />
          )}
        </div>
      </div>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        marginTop: '40px',
        color: 'white',
        fontSize: '14px',
        opacity: 0.8,
      }}>
        <p>ArchDisc - Democratizing Design Through AI</p>
        <p style={{ marginTop: '5px' }}>
          Unifying ideation, 3D modeling, analysis, and legality into one intelligent workspace
        </p>
      </footer>
    </div>
  );
}

export default App;
