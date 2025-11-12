import { modes } from '../config/menuConfig';

export default function ModeSelector({ currentMode, onModeChange }) {
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
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onModeChange(mode.id)}
          title={`${mode.label}${mode.shortcut ? ` (${mode.shortcut})` : ''}`}
          style={{
            padding: '6px 10px',
            background: currentMode === mode.id ? 'var(--accent-orange)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: currentMode === mode.id ? 'white' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: currentMode === mode.id ? '500' : 'normal',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
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
          <span style={{ fontSize: '14px' }}>{mode.icon}</span>
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
}
