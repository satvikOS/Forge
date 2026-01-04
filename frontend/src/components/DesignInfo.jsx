export default function DesignInfo({ design, analysis, compliance }) {
  if (!design) {
    return (
      <div style={{
        padding: '20px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        textAlign: 'center',
        color: '#666',
      }}>
        <p>No design generated yet. Enter a prompt to get started!</p>
      </div>
    );
  }

  const { specifications } = design;

  return (
    <div style={{
      padding: '20px',
      background: 'white',
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      maxHeight: '600px',
      overflowY: 'auto',
    }}>
      <h2 style={{ marginBottom: '15px', color: '#333' }}>Design Details</h2>

      {/* Specifications */}
      <section style={{ marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '10px', color: '#667eea' }}>Specifications</h3>
        <div style={{ background: '#f9f9f9', padding: '12px', borderRadius: '6px' }}>
          <p><strong>Type:</strong> {specifications.objectType}</p>
          <p><strong>Description:</strong> {specifications.description}</p>
          {specifications.style && <p><strong>Style:</strong> {specifications.style}</p>}
          
          {specifications.dimensions && (
            <div style={{ marginTop: '10px' }}>
              <strong>Dimensions:</strong>
              <ul style={{ marginLeft: '20px', marginTop: '5px' }}>
                {Object.entries(specifications.dimensions).map(([key, value]) => (
                  <li key={key}>{key}: {value}mm</li>
                ))}
              </ul>
            </div>
          )}
          
          {specifications.materials && (
            <div style={{ marginTop: '10px' }}>
              <strong>Materials:</strong> {specifications.materials.join(', ')}
            </div>
          )}
          
          {specifications.features && (
            <div style={{ marginTop: '10px' }}>
              <strong>Features:</strong>
              <ul style={{ marginLeft: '20px', marginTop: '5px' }}>
                {specifications.features.map((feature, idx) => (
                  <li key={idx}>{feature}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Analysis Results */}
      {analysis && (
        <section style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '10px', color: '#667eea' }}>Analysis</h3>
          <div style={{ background: '#f9f9f9', padding: '12px', borderRadius: '6px' }}>
            <p><strong>Overall Score:</strong> {analysis.overallScore}/100</p>
            
            {analysis.structural && (
              <div style={{ marginTop: '10px' }}>
                <strong>Structural Analysis:</strong>
                <ul style={{ marginLeft: '20px', marginTop: '5px', fontSize: '14px' }}>
                  <li>Strength: {analysis.structural.strength.toFixed(1)}/100</li>
                  <li>Stability: {analysis.structural.stability.toFixed(1)}/100</li>
                  <li>Safety Factor: {analysis.structural.safetyFactor.toFixed(1)}/100</li>
                </ul>
              </div>
            )}
            
            {analysis.cost && (
              <div style={{ marginTop: '10px' }}>
                <strong>Cost Estimate:</strong> ${analysis.cost.estimated.toLocaleString()} {analysis.cost.currency}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Compliance Results */}
      {compliance && (
        <section>
          <h3 style={{ fontSize: '16px', marginBottom: '10px', color: '#667eea' }}>Compliance</h3>
          <div style={{ 
            background: compliance.compliant ? '#e8f5e9' : '#fff3e0',
            padding: '12px',
            borderRadius: '6px',
            border: `2px solid ${compliance.compliant ? '#4caf50' : '#ff9800'}`,
          }}>
            <p>
              <strong>Status:</strong>{' '}
              <span style={{ color: compliance.compliant ? '#4caf50' : '#ff9800' }}>
                {compliance.compliant ? '✓ Compliant' : '⚠ Needs Review'}
              </span>
            </p>
            <p><strong>Score:</strong> {compliance.score}/100</p>
            
            {compliance.recommendations && compliance.recommendations.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <strong>Recommendations:</strong>
                <ul style={{ marginLeft: '20px', marginTop: '5px', fontSize: '14px' }}>
                  {compliance.recommendations.map((rec, idx) => (
                    <li key={idx} style={{ marginBottom: '5px' }}>
                      {rec.recommendation}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
