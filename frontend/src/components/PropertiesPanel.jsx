import { useState, useEffect } from 'react';

export default function PropertiesPanel({ design, analysis, compliance }) {
  const [activeTab, setActiveTab] = useState('specs');

  const tabs = [
    { id: 'specs', label: 'Specifications', icon: '📋' },
    { id: 'analysis', label: 'Analysis', icon: '📊' },
    { id: 'compliance', label: 'Compliance', icon: '✓' },
    { id: 'edit', label: 'Edit Properties', icon: '⚙' },
  ];

  if (!design) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        textAlign: 'center',
        padding: '20px',
      }}>
        <div>
          <div style={{ fontSize: '48px', marginBottom: '10px' }}>🎨</div>
          <div>No design generated yet</div>
          <div style={{ fontSize: '12px', marginTop: '5px' }}>
            Use the prompt bar below to create a design
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
    }}>
      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: '12px 8px',
              background: activeTab === tab.id ? 'var(--bg-secondary)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-orange)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) {
                e.target.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) {
                e.target.style.background = 'transparent';
              }
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '15px',
      }}>
        {activeTab === 'specs' && design.specifications && (
          <SpecificationsTab specs={design.specifications} />
        )}
        {activeTab === 'analysis' && analysis && (
          <AnalysisTab analysis={analysis} />
        )}
        {activeTab === 'compliance' && compliance && (
          <ComplianceTab compliance={compliance} />
        )}
        {activeTab === 'edit' && (
          <EditTab />
        )}
      </div>
    </div>
  );
}

function SpecificationsTab({ specs }) {
  return (
    <div>
      <PropertyGroup title="General">
        <Property label="Type" value={specs.objectType} />
        <Property label="Description" value={specs.description} />
        {specs.style && <Property label="Style" value={specs.style} />}
      </PropertyGroup>

      {specs.dimensions && (
        <PropertyGroup title="Dimensions">
          {Object.entries(specs.dimensions).map(([key, value]) => (
            <Property key={key} label={key} value={`${value}mm`} />
          ))}
        </PropertyGroup>
      )}

      {specs.materials && (
        <PropertyGroup title="Materials">
          <Property label="Materials" value={specs.materials.join(', ')} />
        </PropertyGroup>
      )}

      {specs.features && specs.features.length > 0 && (
        <PropertyGroup title="Features">
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
            {specs.features.map((feature, idx) => (
              <li key={idx} style={{ marginBottom: '5px' }}>{feature}</li>
            ))}
          </ul>
        </PropertyGroup>
      )}
    </div>
  );
}

function AnalysisTab({ analysis }) {
  return (
    <div>
      <PropertyGroup title="Overall">
        <Property 
          label="Score" 
          value={`${analysis.overallScore}/100`}
          valueColor={analysis.overallScore >= 70 ? '#4caf50' : analysis.overallScore >= 50 ? '#ff9800' : '#f44336'}
        />
      </PropertyGroup>

      {analysis.structural && (
        <PropertyGroup title="Structural">
          <Property label="Strength" value={`${analysis.structural.strength.toFixed(1)}/100`} />
          <Property label="Stability" value={`${analysis.structural.stability.toFixed(1)}/100`} />
          <Property label="Safety Factor" value={`${analysis.structural.safetyFactor.toFixed(1)}/100`} />
        </PropertyGroup>
      )}

      {analysis.cost && (
        <PropertyGroup title="Cost">
          <Property 
            label="Estimated" 
            value={`$${analysis.cost.estimated.toLocaleString()} ${analysis.cost.currency}`}
            valueColor="var(--accent-orange)"
          />
          {analysis.cost.breakdown && (
            <>
              <Property label="Materials" value={`$${analysis.cost.breakdown.materials.toLocaleString()}`} />
              <Property label="Labor" value={`$${analysis.cost.breakdown.labor.toLocaleString()}`} />
              <Property label="Overhead" value={`$${analysis.cost.breakdown.overhead.toLocaleString()}`} />
            </>
          )}
        </PropertyGroup>
      )}
    </div>
  );
}

function ComplianceTab({ compliance }) {
  return (
    <div>
      <PropertyGroup title="Status">
        <Property 
          label="Compliant" 
          value={compliance.compliant ? '✓ Yes' : '⚠ Needs Review'}
          valueColor={compliance.compliant ? '#4caf50' : '#ff9800'}
        />
        <Property label="Score" value={`${compliance.score}/100`} />
      </PropertyGroup>

      {compliance.recommendations && compliance.recommendations.length > 0 && (
        <PropertyGroup title="Recommendations">
          {compliance.recommendations.map((rec, idx) => (
            <div 
              key={idx}
              style={{
                padding: '10px',
                background: 'var(--bg-tertiary)',
                borderRadius: '6px',
                marginBottom: '8px',
                fontSize: '12px',
              }}
            >
              <div style={{ 
                color: 'var(--accent-orange)', 
                fontWeight: 'bold',
                marginBottom: '4px',
              }}>
                {rec.issue}
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>
                {rec.recommendation}
              </div>
            </div>
          ))}
        </PropertyGroup>
      )}
    </div>
  );
}

function EditTab() {
  return (
    <div>
      <PropertyGroup title="Transform">
        <EditableProperty label="Position X" value="0.0" unit="m" />
        <EditableProperty label="Position Y" value="0.0" unit="m" />
        <EditableProperty label="Position Z" value="0.0" unit="m" />
      </PropertyGroup>

      <PropertyGroup title="Rotation">
        <EditableProperty label="Rotation X" value="0.0" unit="°" />
        <EditableProperty label="Rotation Y" value="0.0" unit="°" />
        <EditableProperty label="Rotation Z" value="0.0" unit="°" />
      </PropertyGroup>

      <PropertyGroup title="Scale">
        <EditableProperty label="Scale X" value="1.0" unit="×" />
        <EditableProperty label="Scale Y" value="1.0" unit="×" />
        <EditableProperty label="Scale Z" value="1.0" unit="×" />
      </PropertyGroup>

      <PropertyGroup title="Material">
        <div style={{ 
          padding: '10px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          textAlign: 'center',
        }}>
          Material editing coming soon
        </div>
      </PropertyGroup>
    </div>
  );
}

function PropertyGroup({ title, children }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h3 style={{
        fontSize: '12px',
        color: 'var(--accent-orange)',
        marginBottom: '10px',
        fontWeight: 'bold',
      }}>
        {title}
      </h3>
      <div style={{
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        padding: '12px',
      }}>
        {children}
      </div>
    </div>
  );
}

function Property({ label, value, valueColor }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '8px',
      fontSize: '12px',
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{ 
        color: valueColor || 'var(--text-primary)',
        fontWeight: '500',
      }}>
        {value}
      </span>
    </div>
  );
}

function EditableProperty({ label, value, unit }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px',
      fontSize: '12px',
    }}>
      <span style={{ color: 'var(--text-secondary)', flex: '0 0 80px' }}>{label}:</span>
      <input
        type="number"
        step="0.1"
        defaultValue={value}
        style={{
          flex: 1,
          padding: '6px 8px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: 'var(--text-primary)',
          fontSize: '12px',
          marginRight: '5px',
        }}
      />
      <span style={{ color: 'var(--text-secondary)', flex: '0 0 20px' }}>{unit}</span>
    </div>
  );
}
