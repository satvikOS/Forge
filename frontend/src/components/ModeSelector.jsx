import { modes } from '../config/menuConfig';

export default function ModeSelector({ currentMode, onModeChange }) {
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
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onModeChange(mode.id)}
          title={`${mode.label}${mode.shortcut ? ` (${mode.shortcut})` : ''}`}
          style={{
            padding: '3px 6px',
            background: currentMode === mode.id ? 'var(--accent-orange)' : 'transparent',
            border: 'none',
            borderRadius: '3px',
            color: currentMode === mode.id ? 'white' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '10px',
            fontWeight: currentMode === mode.id ? '500' : 'normal',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            if (currentMode !== mode.id) {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (currentMode !== mode.id) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          <span style={{ fontSize: '11px' }}>{mode.icon}</span>
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
}
