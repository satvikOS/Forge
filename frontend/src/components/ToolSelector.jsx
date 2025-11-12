import { tools } from '../config/menuConfig';

export default function ToolSelector({ currentMode, activeTool, onToolChange }) {
  const modeTools = tools[currentMode] || tools.object;

  return (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        background: 'var(--bg-tertiary)',
        borderRadius: '4px',
        padding: '2px',
      }}
    >
      {modeTools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
          style={{
            padding: '3px 6px',
            background: activeTool === tool.id ? 'var(--accent-orange)' : 'transparent',
            border: 'none',
            borderRadius: '3px',
            color: activeTool === tool.id ? 'white' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: activeTool === tool.id ? '500' : 'normal',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== tool.id) {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTool !== tool.id) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          <span style={{ fontSize: '12px' }}>{tool.icon}</span>
          <span>{tool.label}</span>
        </button>
      ))}
    </div>
  );
}
