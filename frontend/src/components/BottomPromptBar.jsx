import { useState } from 'react';

export default function BottomPromptBar({ onSubmit, loading }) {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

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
      {/* ArchPro proposals popup */}
      {isExpanded && (
        <div style={{
          position: 'fixed',
          bottom: '70px',
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
              Use <span style={{ color: 'var(--accent-orange)', fontWeight: '600' }}>ArchPro</span> prefix for 3 AI design proposals:
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
                  setPrompt(`ArchPro ${example}`);
                  setIsExpanded(false);
                }}
                disabled={loading}
                style={{
                  padding: '10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
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
                <span style={{ color: 'var(--accent-orange)', fontWeight: '600' }}>ArchPro</span> {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom prompt bar - Floating with glassmorphic effect */}
      <div 
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '90%',
          maxWidth: '1200px',
          background: 'rgba(26, 26, 26, 0.7)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: `2px solid ${isHovered ? 'rgba(255, 107, 53, 0.8)' : 'rgba(255, 107, 53, 0.3)'}`,
          borderRadius: '12px',
          padding: '8px 12px',
          zIndex: 1000,
          boxShadow: isHovered 
            ? '0 8px 32px rgba(255, 107, 53, 0.3), 0 0 20px rgba(255, 107, 53, 0.2)' 
            : '0 8px 32px rgba(0, 0, 0, 0.4)',
          transition: 'all 0.3s ease',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <form onSubmit={handleSubmit} style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}>
          {/* ArchPro button */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={loading}
            style={{
              background: 'rgba(42, 42, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '0 12px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-orange)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '11px',
              fontWeight: '600',
              flexShrink: 0,
              letterSpacing: '0.5px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.background = 'rgba(255, 107, 53, 0.2)';
                e.target.style.borderColor = 'var(--accent-orange)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(42, 42, 42, 0.6)';
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
            title="ArchPro: Get 3 AI-powered design proposals"
          >
            ArchPro
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
              padding: '8px 12px',
              background: 'rgba(42, 42, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
              height: '32px',
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

          {/* Submit button with loading spinner or paper plane icon */}
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              background: loading || !prompt.trim() ? 'rgba(42, 42, 42, 0.6)' : 'var(--accent-orange)',
              border: 'none',
              borderRadius: '8px',
              width: '32px',
              height: '32px',
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
                e.target.style.background = 'var(--accent-orange-hover)';
                e.target.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.background = 'var(--accent-orange)';
                e.target.style.transform = 'scale(1)';
              }
            }}
          >
            {loading ? (
              <div className="spinner" style={{ width: '16px', height: '16px' }} />
            ) : (
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                style={{ transform: 'rotate(45deg)' }}
              >
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
