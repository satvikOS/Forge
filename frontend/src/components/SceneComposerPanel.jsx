/**
 * Scene Composer Panel - UI for generating complete scenes from natural language prompts
 */

import { useState } from 'react';

export default function SceneComposerPanel({ sceneComposer, onSceneGenerated }) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState(null);
  const [error, setError] = useState(null);

  const availableScenes = sceneComposer ? sceneComposer.getAvailableScenes() : [];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    
    try {
      const scene = await sceneComposer.generateSceneFromPrompt(prompt);
      setLastGenerated(scene);
      if (onSceneGenerated) {
        onSceneGenerated(scene);
      }
    } catch (err) {
      console.error('Error generating scene:', err);
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTemplateClick = (template) => {
    setPrompt(template.description);
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <h3 style={{
          margin: '0 0 8px 0',
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary)',
        }}>
          🎨 Scene Composer
        </h3>
        <p style={{
          margin: 0,
          fontSize: '11px',
          color: 'var(--text-secondary)',
          lineHeight: '1.4',
        }}>
          Describe an entire environment in natural language, and watch it come to life with coordinated 3D assets.
        </p>
      </div>

      {/* Prompt Input */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <label style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: '500',
          color: 'var(--text-primary)',
          marginBottom: '8px',
        }}>
          Describe your scene:
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., 'Create a futuristic city with tall buildings and advanced infrastructure' or 'Generate a peaceful medieval village surrounded by mountains'"
          style={{
            width: '100%',
            minHeight: '80px',
            padding: '10px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          style={{
            marginTop: '8px',
            width: '100%',
            padding: '10px',
            background: isGenerating ? 'var(--bg-tertiary)' : 'var(--accent-color)',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            fontSize: '13px',
            fontWeight: '600',
            cursor: isGenerating || !prompt.trim() ? 'not-allowed' : 'pointer',
            opacity: isGenerating || !prompt.trim() ? 0.6 : 1,
          }}
        >
          {isGenerating ? '⏳ Generating Scene...' : '✨ Generate Scene'}
        </button>
        
        {error && (
          <div style={{
            marginTop: '8px',
            padding: '8px',
            background: '#ff000015',
            border: '1px solid #ff000030',
            borderRadius: '4px',
            color: '#ff4444',
            fontSize: '11px',
          }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* Scene Templates */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
      }}>
        <div style={{
          marginBottom: '12px',
          fontSize: '12px',
          fontWeight: '500',
          color: 'var(--text-primary)',
        }}>
          Quick Scene Templates:
        </div>
        
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          {availableScenes.map(template => (
            <div
              key={template.id}
              onClick={() => handleTemplateClick(template)}
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-color)';
                e.currentTarget.style.transform = 'translateX(4px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.transform = 'translateX(0)';
              }}
            >
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: 'var(--text-primary)',
                marginBottom: '4px',
                textTransform: 'capitalize',
              }}>
                {template.theme}
              </div>
              <div style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                marginBottom: '6px',
                lineHeight: '1.4',
              }}>
                {template.description}
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px',
              }}>
                {template.keywords.slice(0, 4).map(keyword => (
                  <span
                    key={keyword}
                    style={{
                      fontSize: '9px',
                      padding: '2px 6px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '3px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Last Generated Scene Info */}
        {lastGenerated && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'var(--accent-secondary)',
            border: '1px solid var(--accent-color)',
            borderRadius: '6px',
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}>
              ✅ Scene Generated
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              lineHeight: '1.5',
            }}>
              <div><strong>Theme:</strong> {lastGenerated.theme}</div>
              <div><strong>Assets:</strong> {lastGenerated.assets.length} objects</div>
              <div><strong>Template:</strong> {lastGenerated.template}</div>
            </div>
          </div>
        )}
      </div>

      {/* Examples Section */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
      }}>
        <div style={{
          fontSize: '11px',
          fontWeight: '500',
          color: 'var(--text-primary)',
          marginBottom: '6px',
        }}>
          💡 Try these prompts:
        </div>
        <div style={{
          fontSize: '10px',
          color: 'var(--text-secondary)',
          lineHeight: '1.6',
        }}>
          • "Create a futuristic city"<br />
          • "Generate a medieval village"<br />
          • "Build a coastal town with beach"<br />
          • "Make an industrial complex"<br />
          • "Design a natural forest landscape"
        </div>
      </div>
    </div>
  );
}
