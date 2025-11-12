import { useState } from 'react';

export default function Sidebar({ design, analysis, compliance }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('properties');

  return (
    <>
      {/* Sidebar Panel */}
      <div style={{
        position: 'fixed',
        top: '36px', // Below topbar
        right: isOpen ? '0' : '-350px',
        width: '350px',
        height: 'calc(100vh - 36px)',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        transition: 'right 0.3s ease',
        overflowY: 'auto',
        zIndex: 50,
        boxShadow: isOpen ? '-4px 0 16px rgba(0, 0, 0, 0.3)' : 'none',
      }}>
        <div style={{ padding: '20px' }}>
          {/* Header with Tabs */}
          <div style={{
            marginBottom: '20px',
            paddingBottom: '0',
            borderBottom: '1px solid var(--border-color)',
          }}>
            <div style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '-1px',
            }}>
              <button
                onClick={() => setActiveTab('properties')}
                style={{
                  padding: '10px 16px',
                  background: activeTab === 'properties' ? 'var(--bg-primary)' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'properties' ? '2px solid var(--accent-orange)' : '2px solid transparent',
                  color: activeTab === 'properties' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: '14px',
                  fontWeight: activeTab === 'properties' ? '600' : 'normal',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== 'properties') {
                    e.target.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== 'properties') {
                    e.target.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                Properties
              </button>
              {design && (
                <button
                  onClick={() => setActiveTab('outputs')}
                  style={{
                    padding: '10px 16px',
                    background: activeTab === 'outputs' ? 'var(--bg-primary)' : 'transparent',
                    border: 'none',
                    borderBottom: activeTab === 'outputs' ? '2px solid var(--accent-orange)' : '2px solid transparent',
                    color: activeTab === 'outputs' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '14px',
                    fontWeight: activeTab === 'outputs' ? '600' : 'normal',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (activeTab !== 'outputs') {
                      e.target.style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== 'outputs') {
                      e.target.style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  Outputs
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          {!design ? (
            <div style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: 'var(--text-secondary)',
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📐</div>
              <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                No design loaded
              </div>
              <div style={{ fontSize: '12px' }}>
                Generate a design to view properties
              </div>
            </div>
          ) : activeTab === 'properties' ? (
            <>
              {/* Design Info */}
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: 'var(--accent-orange)',
                  marginBottom: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Design
                </h3>
                <div style={{
                  background: 'var(--bg-tertiary)',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}>
                  {design.name && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                      paddingBottom: '8px',
                      borderBottom: '1px solid var(--border-color)',
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Name:</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                        {design.name}
                      </span>
                    </div>
                  )}
                  {design.category && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Category:</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {design.category}
                      </span>
                    </div>
                  )}
                  {design.description && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{
                        color: 'var(--text-secondary)',
                        fontSize: '12px',
                        marginBottom: '6px',
                      }}>
                        Description:
                      </div>
                      <div style={{ color: 'var(--text-primary)', lineHeight: '1.5' }}>
                        {design.description}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Analysis */}
              {analysis && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: 'var(--accent-orange)',
                    marginBottom: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Analysis
                  </h3>
                  <div style={{
                    background: 'var(--bg-tertiary)',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}>
                    {analysis.structuralIntegrity && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{
                          color: 'var(--text-secondary)',
                          fontSize: '12px',
                          marginBottom: '6px',
                        }}>
                          Structural Integrity:
                        </div>
                        <div style={{
                          color: analysis.structuralIntegrity.score >= 80 ? '#4caf50' : 
                                 analysis.structuralIntegrity.score >= 60 ? 'var(--accent-orange)' : '#f44336',
                          fontWeight: '500',
                        }}>
                          {analysis.structuralIntegrity.score}/100
                        </div>
                      </div>
                    )}
                    {analysis.summary && (
                      <div style={{
                        color: 'var(--text-primary)',
                        lineHeight: '1.5',
                        fontSize: '12px',
                      }}>
                        {analysis.summary}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Compliance */}
              {compliance && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{
                    fontSize: '14px',
                    fontWeight: 'bold',
                    color: 'var(--accent-orange)',
                    marginBottom: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Compliance
                  </h3>
                  <div style={{
                    background: 'var(--bg-tertiary)',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '12px',
                    }}>
                      <div style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: compliance.status === 'compliant' ? '#4caf50' : 
                                   compliance.status === 'warning' ? 'var(--accent-orange)' : '#f44336',
                      }} />
                      <span style={{
                        color: 'var(--text-primary)',
                        fontWeight: '500',
                        textTransform: 'capitalize',
                      }}>
                        {compliance.status || 'Unknown'}
                      </span>
                    </div>
                    {compliance.checks && compliance.checks.length > 0 && (
                      <div>
                        {compliance.checks.map((check, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '8px',
                              marginBottom: '6px',
                              background: 'var(--bg-primary)',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                          >
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              marginBottom: '4px',
                            }}>
                              <span>{check.passed ? '✓' : '✗'}</span>
                              <span style={{
                                color: check.passed ? '#4caf50' : '#f44336',
                                fontWeight: '500',
                              }}>
                                {check.name}
                              </span>
                            </div>
                            {check.message && (
                              <div style={{
                                color: 'var(--text-secondary)',
                                fontSize: '11px',
                                marginLeft: '20px',
                              }}>
                                {check.message}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            // Outputs Tab
            <div>
              {/* Problem & Objectives */}
              <OutputSection
                title="Problem & Objectives"
                icon="🎯"
                content={design.outputs?.problemObjectives || generateProblemObjectives(design)}
              />

              {/* Functional Requirements & KPIs */}
              <OutputSection
                title="Functional Requirements & KPIs"
                icon="📋"
                content={design.outputs?.requirements || generateRequirements(design)}
              />

              {/* System Architecture & Components */}
              <OutputSection
                title="System Architecture & Components"
                icon="🏗️"
                content={design.outputs?.architecture || generateArchitecture(design)}
              />

              {/* Starter BOM (rough) */}
              <OutputSection
                title="Starter BOM (rough)"
                icon="📦"
                content={design.outputs?.bom || generateBOM(design)}
              />

              {/* Regulatory & Legal Checklist */}
              <OutputSection
                title="Regulatory & Legal Checklist"
                icon="⚖️"
                content={design.outputs?.regulatory || generateRegulatory(design)}
              />

              {/* Risks & Mitigations */}
              <OutputSection
                title="Risks & Mitigations"
                icon="⚠️"
                content={design.outputs?.risks || generateRisks(design)}
              />

              {/* Development Timeline */}
              <OutputSection
                title="Development Timeline"
                icon="📅"
                content={design.outputs?.timeline || generateTimeline(design)}
              />

              {/* Rough Costing */}
              <OutputSection
                title="Rough Costing"
                icon="💰"
                content={design.outputs?.costing || generateCosting(design)}
              />

              {/* Next Steps */}
              <OutputSection
                title="Next Steps"
                icon="🚀"
                content={design.outputs?.nextSteps || generateNextSteps(design)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          top: '50%',
          right: isOpen ? '350px' : '0',
          transform: 'translateY(-50%)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRight: isOpen ? '1px solid var(--border-color)' : 'none',
          borderTopLeftRadius: '8px',
          borderBottomLeftRadius: '8px',
          padding: '12px 6px',
          cursor: 'pointer',
          fontSize: '16px',
          color: 'var(--text-primary)',
          transition: 'all 0.3s ease',
          zIndex: 51,
          boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.2)',
        }}
        onMouseEnter={(e) => {
          e.target.style.background = 'var(--accent-orange)';
          e.target.style.color = 'white';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = 'var(--bg-secondary)';
          e.target.style.color = 'var(--text-primary)';
        }}
      >
        {isOpen ? '→' : '←'}
      </button>
    </>
  );
}

// OutputSection Component
function OutputSection({ title, icon, content }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div style={{ marginBottom: '16px' }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{ fontSize: '16px' }}>{icon}</span>
          <span style={{
            fontSize: '13px',
            fontWeight: '600',
            color: 'var(--text-primary)',
          }}>
            {title}
          </span>
        </div>
        <span style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
        }}>
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {isExpanded && (
        <div style={{
          padding: '12px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderTop: 'none',
          borderBottomLeftRadius: '8px',
          borderBottomRightRadius: '8px',
          fontSize: '12px',
          color: 'var(--text-primary)',
          lineHeight: '1.6',
        }}>
          {Array.isArray(content) ? (
            <ul style={{
              margin: 0,
              paddingLeft: '20px',
            }}>
              {content.map((item, idx) => (
                <li key={idx} style={{ marginBottom: '6px' }}>{item}</li>
              ))}
            </ul>
          ) : (
            <div>{content}</div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper functions to generate content based on design
function generateProblemObjectives(design) {
  const category = design.category || 'architectural design';
  return [
    `Address the need for ${category} solutions`,
    `Optimize space utilization and functionality`,
    `Ensure structural integrity and safety`,
    `Meet user requirements and expectations`,
    `Maintain cost-effectiveness and sustainability`
  ];
}

function generateRequirements(design) {
  return [
    `✓ Load-bearing capacity: Meet structural standards`,
    `✓ Space efficiency: Optimize floor area usage`,
    `✓ Accessibility: Comply with accessibility standards`,
    `✓ Energy efficiency: Target 30% reduction vs baseline`,
    `✓ Material durability: 20+ year lifespan`
  ];
}

function generateArchitecture(design) {
  return [
    `Foundation System: Reinforced concrete base`,
    `Structural Framework: Steel/wood frame construction`,
    `Envelope: Weather-resistant exterior cladding`,
    `MEP Systems: Integrated mechanical, electrical, plumbing`,
    `Interior Systems: Modular partition walls and finishes`
  ];
}

function generateBOM(design) {
  return [
    `Structural materials: Steel beams, concrete, lumber`,
    `Exterior finishes: Cladding, roofing, windows`,
    `Interior finishes: Drywall, flooring, paint`,
    `MEP components: HVAC units, electrical panels, plumbing fixtures`,
    `Hardware & fixtures: Doors, handles, lighting`
  ];
}

function generateRegulatory(design) {
  return [
    `☐ Building permit application`,
    `☐ Zoning compliance verification`,
    `☐ Fire safety code review`,
    `☐ Structural engineering approval`,
    `☐ Environmental impact assessment`,
    `☐ Accessibility standards compliance`
  ];
}

function generateRisks(design) {
  return [
    `Weather delays → Mitigation: Build buffer time into schedule`,
    `Cost overruns → Mitigation: 15% contingency budget`,
    `Material shortages → Mitigation: Pre-order long-lead items`,
    `Code violations → Mitigation: Early permit review`,
    `Site conditions → Mitigation: Thorough site survey`
  ];
}

function generateTimeline(design) {
  return [
    `Phase 1: Design & Permits (2-3 months)`,
    `Phase 2: Site Preparation (2-4 weeks)`,
    `Phase 3: Foundation Work (4-6 weeks)`,
    `Phase 4: Structural Build (8-12 weeks)`,
    `Phase 5: Systems & Finishes (6-8 weeks)`,
    `Phase 6: Final Inspection (1-2 weeks)`
  ];
}

function generateCosting(design) {
  return [
    `Design & Engineering: $15,000 - $25,000`,
    `Permits & Fees: $5,000 - $10,000`,
    `Site Work: $20,000 - $40,000`,
    `Materials: $150,000 - $250,000`,
    `Labor: $100,000 - $180,000`,
    `Contingency (15%): $43,500 - $75,750`,
    `Total Estimated Range: $333,500 - $580,750`
  ];
}

function generateNextSteps(design) {
  return [
    `1. Review and approve design concept`,
    `2. Engage structural engineer for detailed plans`,
    `3. Submit permit applications to local authorities`,
    `4. Obtain project financing and insurance`,
    `5. Select and contract with general contractor`,
    `6. Schedule site survey and geotechnical testing`,
    `7. Finalize material selections and order long-lead items`
  ];
}
