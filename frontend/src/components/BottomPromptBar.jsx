import { useState } from 'react';

export default function BottomPromptBar({ onSubmit, onGenerateProposals, loading }) {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim() && !loading) {
      onSubmit(prompt);
    }
  };

  const handleArchPro = () => {
    if (prompt.trim() && !loading) {
      onGenerateProposals(prompt);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const examplePrompts = [
    'Design a modern sports car',
    'Create a contemporary office building',
    'Design an ergonomic office chair',
  ];

  return (
    <>
      {/* Example prompts popup */}
      {isExpanded && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(26, 26, 26, 0.98)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          padding: '20px',
          maxWidth: '600px',
          width: '90%',
          zIndex: 999,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '15px',
          }}>
            <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '600' }}>
              Try these examples:
            </span>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '20px',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {examplePrompts.map((example, index) => (
              <button
                key={index}
                onClick={() => {
                  setPrompt(example);
                  setIsExpanded(false);
                }}
                disabled={loading}
                style={{
                  padding: '12px 16px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.target.style.background = 'var(--bg-hover)';
                    e.target.style.borderColor = 'var(--accent-orange)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--bg-tertiary)';
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating prompt bar at bottom */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90%',
        maxWidth: '800px',
        zIndex: 1000,
        pointerEvents: 'none',
      }}>
        <form onSubmit={handleSubmit} style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          background: 'rgba(26, 26, 26, 0.98)',
          backdropFilter: 'blur(20px)',
          padding: '12px 16px',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          pointerEvents: 'auto',
        }}>
          {/* Expand button */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={loading}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '18px',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.background = 'var(--bg-hover)';
                e.target.style.color = 'var(--text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent';
              e.target.style.color = 'var(--text-secondary)';
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
              padding: '10px 16px',
              background: 'rgba(42, 42, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              color: 'var(--text-primary)',
              fontSize: '14px',
              outline: 'none',
              transition: 'all 0.2s',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent-orange)';
              e.target.style.background = 'rgba(42, 42, 42, 0.8)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              e.target.style.background = 'rgba(42, 42, 42, 0.6)';
            }}
          />

          {/* ArchPro button */}
          <button
            type="button"
            onClick={handleArchPro}
            disabled={loading || !prompt.trim()}
            style={{
              padding: '10px 20px',
              background: loading || !prompt.trim() ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              border: 'none',
              borderRadius: '10px',
              color: 'white',
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              flexShrink: 0,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onMouseEnter={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }
            }}
          >
            <span>✨</span>
            <span>ArchPro</span>
          </button>

          {/* Generate button with loading spinner or arrow */}
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              background: loading || !prompt.trim() ? 'var(--bg-tertiary)' : 'var(--accent-orange)',
              border: 'none',
              borderRadius: '10px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              fontSize: '18px',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.background = 'var(--accent-orange-hover)';
                e.target.style.transform = 'translateY(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.background = 'var(--accent-orange)';
                e.target.style.transform = 'translateY(0)';
              }
            }}
          >
            {loading ? (
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
            ) : (
              <span style={{ transform: 'rotate(-90deg)', display: 'inline-block' }}>→</span>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
