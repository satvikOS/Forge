import { useState } from 'react';

export default function FloatingPromptBar({ onSubmit, loading = false }) {
  const [prompt, setPrompt] = useState('');
  const [showExamples, setShowExamples] = useState(false);

  const examplePrompts = [
    'Design a modern two-story house with a garage',
    'Create a minimalist office space with ergonomic furniture',
    'Build a sustainable community center with solar panels',
    'Design a compact urban apartment with efficient storage',
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim() && !loading) {
      onSubmit(prompt);
      setPrompt('');
      setShowExamples(false);
    }
  };

  const handleExampleClick = (example) => {
    setPrompt(example);
    setShowExamples(false);
  };

  const handleArchDiscClick = async () => {
    if (loading) return;
    
    // Generate 3 proposal designs of different themes
    const themes = [
      'modern minimalist style',
      'industrial contemporary style',
      'traditional classic style'
    ];
    
    const proposals = themes.map((theme, idx) => 
      `Proposal ${idx + 1}: Design with ${theme}`
    );
    
    setShowExamples(!showExamples);
    console.log('Generate 3 proposals with different themes:', proposals);
    // Future: trigger actual proposal generation
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'calc(100% - 40px)',
      maxWidth: '900px',
      zIndex: 100,
    }}>
      {/* Example Prompts Popup */}
      {showExamples && (
        <div style={{
          background: 'rgba(26, 26, 26, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '16px',
          marginBottom: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 'bold',
            color: 'var(--text-secondary)',
            marginBottom: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Example Prompts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {examplePrompts.map((example, idx) => (
              <button
                key={idx}
                onClick={() => handleExampleClick(example)}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--accent-orange)';
                  e.target.style.color = 'white';
                  e.target.style.transform = 'translateX(4px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--bg-tertiary)';
                  e.target.style.color = 'var(--text-primary)';
                  e.target.style.transform = 'translateX(0)';
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Floating Prompt Bar */}
      <form onSubmit={handleSubmit}>
        <div style={{
          background: 'rgba(26, 26, 26, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--border-color)',
          borderRadius: '50px',
          padding: '8px 8px 8px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          transition: 'all 0.3s',
        }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 12px 40px rgba(255, 107, 53, 0.3)';
            e.currentTarget.style.borderColor = 'var(--accent-orange)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';
            e.currentTarget.style.borderColor = 'var(--border-color)';
          }}
        >
          {/* ArchDisc Button */}
          <button
            type="button"
            onClick={handleArchDiscClick}
            disabled={loading}
            style={{
              background: showExamples ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
              border: 'none',
              borderRadius: '20px',
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              color: showExamples ? 'white' : 'var(--text-primary)',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.background = 'var(--accent-orange)';
                e.target.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              if (!showExamples) {
                e.target.style.background = 'var(--bg-tertiary)';
                e.target.style.color = 'var(--text-primary)';
              }
            }}
          >
            ArchDisc
          </button>

          {/* Input Field */}
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want to design..."
            disabled={loading}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '14px',
              padding: '8px 0',
            }}
          />

          {/* Submit Button - GitHub Copilot style */}
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              background: (loading || !prompt.trim()) ? 'var(--bg-tertiary)' : 'var(--accent-orange)',
              border: 'none',
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              fontSize: '18px',
              color: 'white',
              transition: 'all 0.2s',
              flexShrink: 0,
              opacity: loading || !prompt.trim() ? 0.5 : 1,
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.transform = 'scale(1.05)';
                e.target.style.boxShadow = '0 4px 16px rgba(255, 107, 53, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'scale(1)';
              e.target.style.boxShadow = 'none';
            }}
          >
            {loading ? (
              <div className="spinner" style={{
                width: '20px',
                height: '20px',
                borderWidth: '2px',
              }} />
            ) : (
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  transform: 'rotate(-45deg)',
                }}
              >
                <path 
                  d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" 
                  stroke="currentColor" 
                  strokeWidth="2.5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </form>

      {/* Keyboard Hint */}
      <div style={{
        textAlign: 'center',
        marginTop: '8px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        opacity: 0.6,
      }}>
        Press Enter to generate • Click ArchDisc for examples
      </div>
    </div>
  );
}
