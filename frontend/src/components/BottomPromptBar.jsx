import { useState, useRef, useEffect } from 'react';

export default function BottomPromptBar({ onSubmit, loading }) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [prompt]);

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

  return (
    <>
      {/* Floating Curved Prompt Bar */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '28px',
        padding: '8px',
        maxWidth: '800px',
        width: '90%',
        zIndex: 1000,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
      }}>
        <form onSubmit={handleSubmit} style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-end',
        }}>
          {/* ArchPro Badge */}
          <div
            style={{
              background: 'linear-gradient(135deg, var(--accent-orange) 0%, #ff8555 100%)',
              border: 'none',
              borderRadius: '20px',
              padding: '0 12px',
              height: '40px',
              minWidth: '85px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '13px',
              fontWeight: 'bold',
              flexShrink: 0,
              letterSpacing: '0.5px',
            }}
          >
            ArchPro
          </div>

          {/* Textarea field */}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to design..."
            disabled={loading}
            rows={1}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              color: 'var(--text-primary)',
              fontSize: '14px',
              outline: 'none',
              resize: 'none',
              minHeight: '40px',
              maxHeight: '150px',
              lineHeight: '20px',
              fontFamily: 'inherit',
              transition: 'all 0.2s',
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
              borderRadius: '20px',
              width: '40px',
              height: '40px',
              minWidth: '40px',
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
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && prompt.trim()) {
                e.target.style.background = 'var(--accent-orange)';
              }
            }}
          >
            {loading ? (
              <div className="spinner" style={{ width: '20px', height: '20px' }} />
            ) : (
              <span style={{ transform: 'rotate(-90deg)', display: 'inline-block' }}>→</span>
            )}
          </button>
        </form>
      </div>
    </>
  );
}
