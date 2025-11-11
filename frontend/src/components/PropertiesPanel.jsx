import { useState, useEffect } from 'react';

export default function PropertiesPanel({ design, analysis, compliance, isCollapsed, onToggleCollapse }) {
  const [activeTab, setActiveTab] = useState('specs');

  const tabs = [
    { id: 'specs', label: 'Specifications' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'compliance', label: 'Compliance' },
    { id: 'projectInfo', label: 'Project Info' },
    { id: 'edit', label: 'Edit Properties' },
  ];

  if (isCollapsed) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
      }}>
        {/* Collapse/Expand Button */}
        <button
          onClick={onToggleCollapse}
          style={{
            padding: '15px 10px',
            background: 'var(--bg-tertiary)',
            border: 'none',
            borderBottom: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'var(--bg-hover)';
            e.target.style.color = 'var(--accent-orange)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'var(--bg-tertiary)';
            e.target.style.color = 'var(--text-secondary)';
          }}
          title="Expand Panel"
        >
          ◀
        </button>
        
        {/* Vertical text hint */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px 0',
        }}>
          <div style={{
            transform: 'rotate(-90deg)',
            whiteSpace: 'nowrap',
            color: 'var(--text-secondary)',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Properties
          </div>
        </div>
      </div>
    );
  }

  if (!design) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)',
        position: 'relative',
      }}>
        {/* Collapse/Expand Button - positioned at left edge of panel */}
        <button
          onClick={onToggleCollapse}
          style={{
            position: 'absolute',
            left: '-30px',
            top: '85px',
            width: '30px',
            height: '30px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px 0 0 4px',
            borderRight: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.target.style.background = 'var(--bg-hover)';
            e.target.style.color = 'var(--accent-orange)';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'var(--bg-tertiary)';
            e.target.style.color = 'var(--text-secondary)';
          }}
          title="Collapse Panel"
        >
          ▶
        </button>
        
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          textAlign: 'center',
          padding: '20px',
        }}>
          <div>
            <div style={{ fontSize: '14px', marginBottom: '10px' }}>No design generated yet</div>
            <div style={{ fontSize: '12px', marginTop: '5px' }}>
              Use the prompt bar below to create a design
            </div>
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
      position: 'relative',
    }}>
      {/* Collapse/Expand Button - positioned at left edge of panel */}
      <button
        onClick={onToggleCollapse}
        style={{
          position: 'absolute',
          left: '-30px',
          top: '5px',
          width: '30px',
          height: '30px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px 0 0 4px',
          borderRight: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          e.target.style.background = 'var(--bg-hover)';
          e.target.style.color = 'var(--accent-orange)';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = 'var(--bg-tertiary)';
          e.target.style.color = 'var(--text-secondary)';
        }}
        title="Collapse Panel"
      >
        ▶
      </button>
      
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
              padding: '10px 6px',
              background: activeTab === tab.id ? 'var(--bg-secondary)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-orange)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '300',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
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
        {activeTab === 'projectInfo' && (
          <ProjectInfoTab design={design} />
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

function ProjectInfoTab({ design }) {
  const [budget, setBudget] = useState('$50,000');
  const [showBOM, setShowBOM] = useState(false);
  const [showBlueprint, setShowBlueprint] = useState(false);
  
  // Single location field for regulation & legality
  const [location, setLocation] = useState('');

  return (
    <div>
      {/* Notice Banner */}
      <div style={{
        padding: '12px',
        background: 'rgba(255, 107, 53, 0.1)',
        border: '1px solid var(--accent-orange)',
        borderRadius: '6px',
        marginBottom: '20px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        textAlign: 'center',
      }}>
        ⚠️ All values are AI-generated estimates and should be considered tentative
      </div>

      {/* Budget */}
      <PropertyGroup title="Budget (Estimated)">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '8px',
        }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Total:</span>
          <input
            type="text"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--accent-orange)',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          />
        </div>
        <div style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
        }}>
          Editable - Adjust based on your requirements
        </div>
      </PropertyGroup>

      {/* Regulation & Legality */}
      <PropertyGroup title="Regulation & Legality">
        {/* Location Input Fields */}
        <div style={{ marginBottom: '15px' }}>
          <div style={{ 
            fontSize: '11px', 
            color: 'var(--accent-orange)', 
            fontWeight: 'bold',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Project Location
          </div>
          
          <input
            type="text"
            placeholder="Enter location (e.g., San Francisco, CA, USA or full address)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              marginBottom: '10px',
            }}
          />

          <button
            onClick={() => {
              console.log('Fetching regulations for:', location);
              // TODO: Call API to get location-specific regulations
            }}
            style={{
              width: '100%',
              marginTop: '10px',
              padding: '8px',
              background: 'var(--accent-orange)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'var(--accent-orange-hover)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'var(--accent-orange)';
            }}
          >
            Get Location-Specific Regulations
          </button>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Building Codes:</span>
            <div style={{ marginTop: '4px', paddingLeft: '10px' }}>
              • International Building Code (IBC) compliance required<br />
              • Local zoning regulations must be verified<br />
              • Permit required before construction
            </div>
          </div>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Safety Standards:</span>
            <div style={{ marginTop: '4px', paddingLeft: '10px' }}>
              • Fire safety codes must be followed<br />
              • Structural integrity certification needed<br />
              • Electrical and plumbing inspections required
            </div>
          </div>
          <div>
            <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Legal Requirements:</span>
            <div style={{ marginTop: '4px', paddingLeft: '10px' }}>
              • Professional architect/engineer review recommended<br />
              • Insurance considerations<br />
              • Property line and easement compliance
            </div>
          </div>
        </div>
      </PropertyGroup>

      {/* BOM - Bill of Materials */}
      <PropertyGroup title="Bill of Materials (BOM)">
        <button
          onClick={() => setShowBOM(!showBOM)}
          style={{
            width: '100%',
            padding: '10px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <span>View Materials & Sources</span>
          <span>{showBOM ? '▲' : '▼'}</span>
        </button>
        {showBOM && (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            background: 'var(--bg-primary)',
            padding: '10px',
            borderRadius: '4px',
            maxHeight: '200px',
            overflowY: 'auto',
          }}>
            <div style={{ marginBottom: '10px' }}>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Structural Materials:</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                • Concrete (5 cubic yards) - Home Depot, Lowes<br />
                • Steel beams (4x 20ft) - Metal Supermarkets<br />
                • Lumber 2x4 (50 pieces) - Home Depot, Menards<br />
                • Rebar (#4, 100ft) - Home Depot, Construction supply
              </div>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Finishing Materials:</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                • Drywall sheets (30 panels) - Home Depot, Lowes<br />
                • Paint (10 gallons) - Sherwin-Williams, Benjamin Moore<br />
                • Flooring (500 sq ft) - Floor & Decor, Lumber Liquidators<br />
                • Windows (6 units) - Andersen, Pella dealers
              </div>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Hardware & Fixtures:</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                • Nails/Screws (assorted) - Home Depot, Lowes<br />
                • Door hardware - Home Depot, Build.com<br />
                • Electrical fixtures - Home Depot, Electrical supply stores<br />
                • Plumbing fixtures - Home Depot, Ferguson
              </div>
            </div>
          </div>
        )}
      </PropertyGroup>

      {/* DIY Blueprint */}
      <PropertyGroup title="Complete DIY Blueprint">
        <button
          onClick={() => setShowBlueprint(!showBlueprint)}
          style={{
            width: '100%',
            padding: '10px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <span>View Step-by-Step Instructions</span>
          <span>{showBlueprint ? '▲' : '▼'}</span>
        </button>
        {showBlueprint && (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            background: 'var(--bg-primary)',
            padding: '10px',
            borderRadius: '4px',
            maxHeight: '200px',
            overflowY: 'auto',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Phase 1: Preparation (1-2 weeks)</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                1. Obtain necessary permits and approvals<br />
                2. Clear and level the construction site<br />
                3. Set up temporary utilities<br />
                4. Establish safety perimeter
              </div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Phase 2: Foundation (2-3 weeks)</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                1. Excavate foundation area<br />
                2. Install footings and drainage<br />
                3. Pour concrete foundation<br />
                4. Allow curing time (minimum 7 days)
              </div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Phase 3: Framing (3-4 weeks)</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                1. Install floor joists and subfloor<br />
                2. Erect wall frames<br />
                3. Install roof trusses<br />
                4. Add sheathing and weatherproofing
              </div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Phase 4: MEP Systems (2-3 weeks)</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                1. Rough electrical wiring<br />
                2. Rough plumbing installation<br />
                3. HVAC ductwork<br />
                4. Inspections
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--accent-orange)', fontWeight: 'bold' }}>Phase 5: Finishing (4-6 weeks)</span>
              <div style={{ paddingLeft: '10px', marginTop: '4px' }}>
                1. Install insulation<br />
                2. Hang and finish drywall<br />
                3. Install flooring<br />
                4. Paint and final touches<br />
                5. Install fixtures and trim<br />
                6. Final inspections
              </div>
            </div>
          </div>
        )}
      </PropertyGroup>

      {/* Duration */}
      <PropertyGroup title="Duration to Complete">
        <Property label="Estimated Timeline" value="12-16 weeks" valueColor="var(--accent-orange)" />
        <div style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid var(--border-color)',
        }}>
          <div style={{ marginBottom: '4px' }}>
            • Preparation: 1-2 weeks<br />
            • Foundation: 2-3 weeks<br />
            • Framing: 3-4 weeks<br />
            • MEP Systems: 2-3 weeks<br />
            • Finishing: 4-6 weeks
          </div>
          <div style={{ marginTop: '8px', fontStyle: 'italic' }}>
            Timeline may vary based on weather, inspections, and material availability
          </div>
        </div>
      </PropertyGroup>

      {/* Disclaimer */}
      <div style={{
        marginTop: '20px',
        padding: '12px',
        background: 'rgba(244, 67, 54, 0.1)',
        border: '1px solid #f44336',
        borderRadius: '6px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        lineHeight: '1.5',
      }}>
        <div style={{ color: '#f44336', fontWeight: 'bold', marginBottom: '6px' }}>
          ⚠️ IMPORTANT DISCLAIMER
        </div>
        AI can make mistakes. Please consult with professionals before proceeding with construction. This information is for reference only and should not be considered as professional advice. Always verify with licensed architects, engineers, and contractors.
      </div>
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
        fontSize: '14px',
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
      fontSize: '13px',
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
      fontSize: '13px',
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
