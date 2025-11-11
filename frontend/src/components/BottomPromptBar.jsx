import { useState } from 'react';

export default function BottomPromptBar({ onSubmit, loading }) {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

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
