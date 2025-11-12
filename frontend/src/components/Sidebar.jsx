import { useState } from 'react';

export default function Sidebar({ design, analysis, compliance }) {
  const [isOpen, setIsOpen] = useState(false);

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
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
            paddingBottom: '15px',
            borderBottom: '1px solid var(--border-color)',
          }}>
            <h2 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: 'var(--text-primary)',
              margin: 0,
            }}>
              Properties
            </h2>
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
          ) : (
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
