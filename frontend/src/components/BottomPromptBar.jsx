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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
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
======= HEAD
          bottom: '70px',
=======
          bottom: '90px',
=======origin/copilot/integrate-blender-sketchup-functions
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
======= HEAD
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Use <span style={{ color: 'var(--accent-orange)', fontWeight: '600' }}>ArchPro</span> prefix for 3 AI design proposals:
=======
            <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>
              Try these examples:
======= origin/copilot/integrate-blender-sketchup-functions
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
=======
                  padding: '10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
=======
                  padding: '12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#ffffff',
======= origin/copilot/integrate-blender-sketchup-functions
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

======= HEAD
      {/* Bottom prompt bar - Floating glassmorphic with compact design */}
      <div 
        style={{
          position: 'fixed',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '85%',
          maxWidth: '1000px',
          background: 'rgba(26, 26, 26, 0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `2px solid ${isHovered ? 'rgba(255, 107, 53, 0.8)' : 'rgba(255, 107, 53, 0.4)'}`,
          borderRadius: '16px',
          padding: '10px 14px',
          zIndex: 1000,
          boxShadow: isHovered 
            ? '0 8px 32px rgba(255, 107, 53, 0.4), 0 0 40px rgba(255, 107, 53, 0.2)' 
            : '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 107, 53, 0.1)',
          transition: 'all 0.3s ease',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <form onSubmit={handleSubmit} style={{
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
        }}>
          {/* ArchPro button */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={loading}
            style={{
              background: 'rgba(255, 107, 53, 0.15)',
              border: '1px solid rgba(255, 107, 53, 0.3)',
              borderRadius: '10px',
              padding: '0 14px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-orange)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: '600',
              flexShrink: 0,
              letterSpacing: '0.5px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.background = 'rgba(255, 107, 53, 0.25)';
                e.target.style.borderColor = 'var(--accent-orange)';
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
=======
      {/* Single Layer Floating Glassmorphic Prompt Bar - 9cm (340px) */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        zIndex: 1000,
      }}>
        {/* ArchPro button - outside the main bar */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          disabled={loading}
          style={{
            background: 'rgba(15, 15, 15, 0.75)',
            backdropFilter: 'blur(30px) saturate(180%)',
            WebkitBackdropFilter: 'blur(30px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '12px',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.9)',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: '600',
            flexShrink: 0,
            transition: 'all 0.2s',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            height: '42px',
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.target.style.background = 'rgba(25, 25, 25, 0.85)';
              e.target.style.borderColor = 'rgba(255, 107, 53, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'rgba(15, 15, 15, 0.75)';
            e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
          }}
        >
          ArchPro
        </button>
======= origin/copilot/integrate-blender-sketchup-functions

        {/* Main prompt bar - exactly 9cm (340px) */}
        <form 
          onSubmit={handleSubmit}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            width: '340px',
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
=======
              padding: '10px 14px',
              background: 'rgba(42, 42, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none',
              height: '38px',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent-orange)';
              e.target.style.background = 'rgba(42, 42, 42, 0.9)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              e.target.style.background = 'rgba(42, 42, 42, 0.7)';
            }}
          />

          {/* Submit button with paper plane icon */}
=======
              padding: '6px 14px',
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: '13px',
              outline: 'none',
              height: '30px',
            }}
          />

          {/* Submit button - Paper Plane Icon inside the bar */}
======= origin/copilot/integrate-blender-sketchup-functions
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
=======
              background: loading || !prompt.trim() ? 'rgba(42, 42, 42, 0.7)' : 'var(--accent-orange)',
              border: 'none',
              borderRadius: '10px',
              width: '38px',
              height: '38px',
=======
              background: loading || !prompt.trim() 
                ? 'rgba(255, 255, 255, 0.05)' 
                : 'linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)',
              border: 'none',
              borderRadius: '14px',
              width: '30px',
              height: '30px',
======= origin/copilot/integrate-blender-sketchup-functions
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
=======
              fontSize: '16px',
              flexShrink: 0,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.background = 'var(--accent-orange-hover)';
                e.target.style.transform = 'scale(1.05)';
=======
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
======= origin/copilot/integrate-blender-sketchup-functions
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
=======
                e.target.style.background = 'var(--accent-orange)';
                e.target.style.transform = 'scale(1)';
=======
                e.target.style.transform = 'scale(1)';
                e.target.style.boxShadow = '0 4px 15px rgba(255, 107, 53, 0.4)';
======= origin/copilot/integrate-blender-sketchup-functions
              }
            }}
          >
            {loading ? (
=======
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
=======
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
======= origin/copilot/integrate-blender-sketchup-functions
              </svg>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
