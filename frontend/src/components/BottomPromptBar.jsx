import { useState } from 'react';
import apiService from '../services/api';

export default function BottomPromptBar({ onSubmit, loading }) {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [showProposals, setShowProposals] = useState(false);
  const [proposals, setProposals] = useState(null);
  const [loadingProposals, setLoadingProposals] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim() && !loading) {
      onSubmit(prompt);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleArchProClick = async () => {
    if (!prompt.trim() || loadingProposals) return;

    setLoadingProposals(true);
    try {
      const result = await apiService.generateProposals(prompt);
      setProposals(result.proposals);
      setShowProposals(true);
    } catch (error) {
      console.error('Error generating proposals:', error);
      alert('Failed to generate proposals. Please try again.');
    } finally {
      setLoadingProposals(false);
    }
  };

  const handleProposalSelect = (proposal) => {
    // Convert proposal to prompt format and submit
    const proposalPrompt = `${proposal.title}: ${proposal.description}`;
    setPrompt(proposalPrompt);
    setShowProposals(false);
    onSubmit(proposalPrompt);
  };

  const examplePrompts = [
    'Design a modern sports car',
    'Create a contemporary office building',
    'Design an ergonomic office chair',
  ];

  return (
    <>
      {/* Proposals Modal */}
      {showProposals && proposals && (
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
            maxWidth: '1000px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'hidden',
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
                ✨ ArchPro Design Proposals
              </h2>
              <button
                onClick={() => setShowProposals(false)}
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

            {/* Proposals */}
            <div style={{
              padding: '20px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
              maxHeight: 'calc(80vh - 80px)',
              overflowY: 'auto',
            }}>
              {proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  style={{
                    padding: '20px',
                    background: 'var(--bg-tertiary)',
                    border: '2px solid var(--border-color)',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-orange)';
                    e.currentTarget.style.transform = 'translateY(-5px)';
                    e.currentTarget.style.boxShadow = '0 8px 20px rgba(255, 107, 53, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  onClick={() => handleProposalSelect(proposal)}
                >
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: 'var(--accent-orange)',
                    marginBottom: '10px',
                  }}>
                    Option {proposal.id}
                  </div>
                  <h3 style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: 'var(--text-primary)',
                    marginBottom: '10px',
                  }}>
                    {proposal.title}
                  </h3>
                  <p style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginBottom: '15px',
                    lineHeight: '1.5',
                  }}>
                    {proposal.description}
                  </p>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    fontSize: '12px',
                  }}>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Style: </span>
                      <span style={{ color: 'var(--text-primary)' }}>{proposal.style}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Materials: </span>
                      <span style={{ color: 'var(--text-primary)' }}>{proposal.materials.join(', ')}</span>
                    </div>
                  </div>
                  <button
                    style={{
                      marginTop: '15px',
                      width: '100%',
                      padding: '10px',
                      background: 'var(--accent-orange)',
                      border: 'none',
                      borderRadius: '6px',
                      color: 'white',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                    }}
                  >
                    Select This Design
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Example prompts popup */}
      {isExpanded && (
        <div style={{
          position: 'fixed',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '15px',
          maxWidth: '600px',
          width: '90%',
          zIndex: 999,
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '10px',
          }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Try these examples:
            </span>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '18px',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {examplePrompts.map((example, index) => (
              <button
                key={index}
                onClick={() => {
                  setPrompt(example);
                  setIsExpanded(false);
                }}
                disabled={loading}
                style={{
                  padding: '10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.target.style.background = 'var(--bg-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--bg-tertiary)';
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom prompt bar */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--bg-secondary)',
        borderTop: '2px solid var(--border-color)',
        padding: '15px 20px',
        zIndex: 1000,
      }}>
        <form onSubmit={handleSubmit} style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
        }}>
          {/* Expand button */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={loading}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'var(--bg-tertiary)';
            }}
          >
            ⋯
          </button>

          {/* Input field */}
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to design..."
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              outline: 'none',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent-orange)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'var(--border-color)';
            }}
          />

          {/* ArchPro Button */}
          <button
            type="button"
            onClick={handleArchProClick}
            disabled={loading || loadingProposals || !prompt.trim()}
            style={{
              padding: '0 20px',
              height: '40px',
              background: loading || loadingProposals || !prompt.trim() 
                ? 'var(--bg-tertiary)' 
                : 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, var(--accent-orange) 100%)',
              border: 'none',
              borderRadius: '6px',
              color: 'white',
              cursor: loading || loadingProposals || !prompt.trim() ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading && !loadingProposals && prompt.trim()) {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 12px rgba(255, 107, 53, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = 'none';
            }}
          >
            {loadingProposals ? (
              <>
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <span>✨</span>
                <span>ArchPro</span>
              </>
            )}
          </button>

          {/* Submit button with loading spinner or arrow */}
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              background: loading || !prompt.trim() ? 'var(--bg-tertiary)' : 'var(--accent-orange)',
              border: 'none',
              borderRadius: '6px',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.background = 'var(--accent-orange-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.background = 'var(--accent-orange)';
              }
            }}
          >
            {loading ? (
              <div className="spinner" />
            ) : (
              <span style={{ transform: 'rotate(-90deg)', display: 'inline-block' }}>→</span>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
