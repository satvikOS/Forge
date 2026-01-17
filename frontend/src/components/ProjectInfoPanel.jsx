import { useState, useEffect } from 'react';

export default function ProjectInfoPanel({ projectInfo, onClose }) {
  if (!projectInfo) {
    return null;
  }

  const { budget, bom, regulations, blueprint, duration, disclaimer, tentative } = projectInfo;

  return (
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
      zIndex: 2000,
      padding: '20px',
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        maxWidth: '900px',
        width: '100%',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        border: '2px solid var(--border-color)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h2 style={{
            fontSize: '12px',
            fontWeight: 'bold',
            color: 'var(--text-primary)',
            margin: 0,
          }}>
            📋 Project Information {tentative && <span style={{ color: 'var(--accent-orange)' }}>(AI-Generated Estimates)</span>}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '5px 10px',
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
        }}>
          {/* Disclaimer */}
          <div style={{
            background: '#ff9800',
            color: '#000',
            padding: '12px',
            borderRadius: '6px',
            marginBottom: '20px',
            fontSize: '12px',
            fontWeight: 'bold',
          }}>
            {disclaimer}
          </div>

          {/* Budget Section */}
          <Section title="💰 Budget Estimate">
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '15px',
              padding: '15px',
              background: 'var(--bg-tertiary)',
              borderRadius: '8px',
              border: '2px solid var(--accent-orange)',
            }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Total Estimated Cost:</span>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent-orange)' }}>
                ${budget.total.toLocaleString()} {budget.currency}
              </span>
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              <BudgetLine label="Materials" amount={budget.breakdown.materials} currency={budget.currency} />
              <BudgetLine label="Labor" amount={budget.breakdown.labor} currency={budget.currency} />
              <BudgetLine label="Equipment" amount={budget.breakdown.equipment} currency={budget.currency} />
              <BudgetLine label="Permits & Fees" amount={budget.breakdown.permits} currency={budget.currency} />
              <BudgetLine label="Contingency (15%)" amount={budget.breakdown.contingency} currency={budget.currency} />
            </div>

            {budget.editable && (
              <div style={{
                marginTop: '10px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                fontStyle: 'italic',
              }}>
                💡 Tip: Adjust these estimates based on your local market prices
              </div>
            )}
          </Section>

          {/* BOM Section */}
          <Section title="📦 Bill of Materials (BOM)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {bom.map((item, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '5px',
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                      {item.item}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--accent-orange)' }}>
                      {item.estimatedCost}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '3px' }}>
                    Quantity: {item.quantity}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Source: {item.source}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Regulations & Compliance */}
          <Section title="⚖️ Regulations & Legality Compliance">
            {regulations.map((category, index) => (
              <div key={index} style={{ marginBottom: '15px' }}>
                <h4 style={{
                  fontSize: '12px',
                  fontWeight: 'bold',
                  color: 'var(--accent-orange)',
                  marginBottom: '8px',
                }}>
                  {category.category}
                </h4>
                <ul style={{
                  margin: 0,
                  paddingLeft: '20px',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                }}>
                  {category.items.map((item, idx) => (
                    <li key={idx} style={{ marginBottom: '5px' }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>

          {/* DIY Blueprint */}
          <Section title="🔨 Step-by-Step DIY Blueprint">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {blueprint.map((step, index) => (
                <div
                  key={index}
                  style={{
                    padding: '15px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    position: 'relative',
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: '15px',
                    left: '15px',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: 'var(--accent-orange)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: 'white',
                  }}>
                    {step.step}
                  </div>
                  <div style={{ marginLeft: '35px' }}>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: 'var(--text-primary)',
                      marginBottom: '5px',
                    }}>
                      {step.title}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '5px',
                    }}>
                      {step.description}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--accent-orange)',
                      fontWeight: 'bold',
                    }}>
                      ⏱️ Duration: {step.duration}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Duration */}
          <Section title="⏰ Estimated Duration to Complete">
            <div style={{
              padding: '15px',
              background: 'var(--bg-tertiary)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-primary)',
                marginBottom: '8px',
              }}>
                <strong>Estimated Time:</strong> {duration.estimated}
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '8px',
              }}>
                <strong>Complexity:</strong> {duration.complexity.charAt(0).toUpperCase() + duration.complexity.slice(1)}
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                fontStyle: 'italic',
              }}>
                {duration.note}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '25px' }}>
      <h3 style={{
        fontSize: '12px',
        fontWeight: 'bold',
        color: 'var(--text-primary)',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function BudgetLine({ label, amount, currency }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '10px 15px',
      background: 'var(--bg-tertiary)',
      borderRadius: '6px',
      fontSize: '12px',
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
        ${amount.toLocaleString()} {currency}
      </span>
    </div>
  );
}
