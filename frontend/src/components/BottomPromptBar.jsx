import { useState } from 'react';

export default function BottomPromptBar({ onSubmit, loading }) {
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim() && !loading) {
      onSubmit(prompt);
      setPrompt(''); // Clear after submit
    }
  };

  const handleKeyDown = (e) => {
    // Allow normal key behavior (including backspace)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
    // Don't prevent default for other keys - let them work normally
  };

  const examplePrompts = [
    'Design a modern sports car with sleek aerodynamics',
    'Create a contemporary glass office building',
    'Design an ergonomic office chair with lumbar support',
  ];

  return (
    <>
      {/* ArchPro proposals popup */}
      {isExpanded && (
        <div style={{
          position: 'fixed',
          bottom: '128px', // Adjusted to be above the moved prompt bar
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(26, 26, 26, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          padding: '16px',
          maxWidth: '700px',
          width: '90%',
          zIndex: 999,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '12px',
          }}>
            <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>
              Use <span style={{ color: 'var(--accent-orange)', fontWeight: '600' }}>ArchPro</span> prefix for 3 AI design proposals:
            </span>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.7)',
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
                  padding: '12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: '13px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.target.style.background = 'rgba(255, 107, 53, 0.15)';
                    e.target.style.borderColor = 'rgba(255, 107, 53, 0.3)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                <span style={{ color: 'var(--accent-orange)', fontWeight: '600' }}>ArchPro</span> {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Single integrated prompt bar with ArchPro inside - increased width */}
      <div style={{
        position: 'fixed',
        bottom: '58px', // Moved up by 38px (~1cm)
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
      }}>
        <form 
          onSubmit={handleSubmit}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            width: '480px', // Increased from 340px to accommodate ArchPro button inside
            background: isHovered 
              ? 'rgba(25, 25, 25, 0.85)' 
              : 'rgba(15, 15, 15, 0.75)',
            backdropFilter: isHovered 
              ? 'blur(35px) saturate(200%)' 
              : 'blur(30px) saturate(180%)',
            WebkitBackdropFilter: isHovered 
              ? 'blur(35px) saturate(200%)' 
              : 'blur(30px) saturate(180%)',
            border: isHovered 
              ? '1px solid rgba(255, 107, 53, 0.4)' 
              : '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '20px',
            padding: '6px',
            boxShadow: isHovered 
              ? '0 12px 40px rgba(255, 107, 53, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15)' 
              : '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            transition: 'all 0.3s ease',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
          }}
        >
          {/* ArchPro button - now inside the bar */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={loading}
            style={{
              background: 'rgba(255, 107, 53, 0.15)',
              border: '1px solid rgba(255, 107, 53, 0.3)',
              borderRadius: '14px',
              padding: '0 12px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ff6b35',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              flexShrink: 0,
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.background = 'rgba(255, 107, 53, 0.25)';
                e.target.style.borderColor = '#ff6b35';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(255, 107, 53, 0.15)';
              e.target.style.borderColor = 'rgba(255, 107, 53, 0.3)';
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
            placeholder="Describe your design..."
            disabled={loading}
            autoComplete="off"
            style={{
              flex: 1,
              padding: '6px 14px',
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: '13px',
              outline: 'none',
              height: '30px',
              whiteSpace: 'nowrap', // Prevent text wrapping - continue horizontally
              overflow: 'hidden', // Hide overflow text
              textOverflow: 'ellipsis', // Show ellipsis for overflow
            }}
          />

          {/* Submit button - Paper Plane Icon */}
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              background: loading || !prompt.trim() 
                ? 'rgba(255, 255, 255, 0.05)' 
                : 'linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)',
              border: 'none',
              borderRadius: '14px',
              width: '30px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              flexShrink: 0,
              transition: 'all 0.2s',
              boxShadow: loading || !prompt.trim() 
                ? 'none' 
                : '0 4px 15px rgba(255, 107, 53, 0.4)',
            }}
            onMouseEnter={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.transform = 'scale(1.05)';
                e.target.style.boxShadow = '0 6px 20px rgba(255, 107, 53, 0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.transform = 'scale(1)';
                e.target.style.boxShadow = '0 4px 15px rgba(255, 107, 53, 0.4)';
              }
            }}
          >
            {loading ? (
              <div className="spinner" style={{
                width: '16px',
                height: '16px',
                border: '2px solid rgba(255, 255, 255, 0.3)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: 'rotate(45deg)' }}
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
