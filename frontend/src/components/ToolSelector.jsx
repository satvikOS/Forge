import { tools } from '../config/menuConfig';

export default function ToolSelector({ currentMode, activeTool, onToolChange }) {
  const modeTools = tools[currentMode] || tools.object;

  return (
    <div
      style={{
        display: 'flex',
        gap: '4px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        padding: '4px',
      }}
    >
      {modeTools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
          style={{
            padding: '8px 12px',
            background: activeTool === tool.id ? 'var(--accent-orange)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: activeTool === tool.id ? 'white' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: activeTool === tool.id ? '500' : 'normal',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
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
          <span style={{ fontSize: '16px' }}>{tool.icon}</span>
          <span>{tool.label}</span>
        </button>
      ))}
    </div>
  );
}
