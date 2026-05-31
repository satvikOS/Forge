import { useState } from 'react';

export default function PromptInput({ onSubmit, loading }) {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim()) {
      onSubmit(prompt);
    }
  };

  const examplePrompts = [
    'Design a modern sports car',
    'Create a contemporary office building',
    'Design an ergonomic office chair',
  ];

  return (
    <div style={{
      padding: '20px',
      background: 'white',
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      <h2 style={{ marginBottom: '15px', color: '#333' }}>Create Your Design</h2>
      
      <form onSubmit={handleSubmit} style={{ marginBottom: '15px' }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you want to design... (e.g., 'Design a modern sports car with aerodynamic features')"
          disabled={loading}
          style={{
            width: '100%',
            minHeight: '100px',
            padding: '12px',
            border: '2px solid #e0e0e0',
            borderRadius: '6px',
            fontSize: '14px',
            fontFamily: 'inherit',
            resize: 'vertical',
            marginBottom: '10px',
          }}
        />
        
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          style={{
            width: '100%',
            padding: '12px 24px',
            background: loading ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!loading && prompt.trim()) {
              e.target.style.transform = 'translateY(-2px)';
            }
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
          }}
        >
          {loading ? 'Generating...' : 'Generate Design'}
        </button>
      </form>

      <div>
        <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>Try these examples:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {examplePrompts.map((example, index) => (
            <button
              key={index}
              onClick={() => setPrompt(example)}
              disabled={loading}
              style={{
                padding: '6px 12px',
                background: '#f5f5f5',
                border: '1px solid #e0e0e0',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.target.style.background = '#e0e0e0';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.background = '#f5f5f5';
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
