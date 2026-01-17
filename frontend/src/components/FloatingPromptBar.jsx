import { useState } from 'react';

export default function FloatingPromptBar({ onSubmit, loading }) {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim() && !loading) {
      onSubmit(prompt);
      setPrompt('');
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
    'Build a futuristic smartphone',
    'Create a minimalist coffee table',
  ];

  return (
    <>
      {/* Example prompts popup */}
      {isExpanded && (
        <div
          style={{
            position: 'fixed',
            bottom: '90px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '15px',
            maxWidth: '600px',
            width: 'calc(100% - 40px)',
            zIndex: 999,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
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
                padding: '0',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
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
                  padding: '10px 14px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.borderColor = 'var(--accent-orange)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating prompt bar */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          maxWidth: '800px',
          width: 'calc(100% - 40px)',
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            background: 'var(--bg-secondary)',
            border: '2px solid var(--border-color)',
            borderRadius: '50px',
            padding: '8px 12px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-orange)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(255, 107, 53, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-color)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.6)';
          }}
        >
          {/* Examples button */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={loading}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--accent-orange)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-tertiary)';
              e.currentTarget.style.color = 'var(--text-secondary)';
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
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '14px',
              outline: 'none',
            }}
          />

          {/* Submit button with loading spinner or arrow */}
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              background: loading || !prompt.trim() ? 'var(--bg-tertiary)' : 'var(--accent-orange)',
              border: 'none',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading && prompt.trim()) {
                e.currentTarget.style.background = 'var(--accent-orange-hover)';
                e.currentTarget.style.transform = 'scale(1.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
                e.currentTarget.style.background = 'var(--accent-orange)';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            {loading ? (
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }} />
            ) : (
              <span style={{ transform: 'rotate(-90deg)', display: 'inline-block' }}>➜</span>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
