export default function Toolbar({ viewMode, onViewModeChange, isExploded, onExplodeToggle }) {
  const tools = [
    { id: 'solid', label: 'Solid', icon: '◼' },
    { id: 'wireframe', label: 'Wireframe', icon: '▢' },
  ];

  return (
    <div style={{
      display: 'flex',
      gap: '10px',
      padding: '8px 12px',
      background: 'rgba(26, 26, 26, 0.95)',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      alignItems: 'center',
      height: '44px',
    }}>
      {/* View mode selector */}
      <div style={{
        display: 'flex',
        gap: '4px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        padding: '3px',
      }}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onViewModeChange(tool.id)}
            style={{
              padding: '6px 14px',
              background: viewMode === tool.id ? 'var(--accent-orange)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: viewMode === tool.id ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: viewMode === tool.id ? '600' : 'normal',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (viewMode !== tool.id) {
                e.target.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (viewMode !== tool.id) {
                e.target.style.background = 'transparent';
              }
            }}
          >
            <span>{tool.icon}</span>
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      {/* Separator */}
      <div style={{
        width: '1px',
        height: '24px',
        background: 'rgba(255, 255, 255, 0.1)',
      }} />

      {/* Explode view toggle */}
      <button
        onClick={onExplodeToggle}
        style={{
          padding: '6px 14px',
          background: isExploded ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '6px',
          color: isExploded ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: isExploded ? '600' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isExploded) {
            e.target.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isExploded) {
            e.target.style.background = 'var(--bg-tertiary)';
          }
        }}
      >
        <span>💥</span>
        <span>Explode</span>
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Quick tools */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {[
          { icon: '↻', label: 'Reset View' },
          { icon: '📷', label: 'Screenshot' },
          { icon: '⚙', label: 'Settings' },
        ].map((tool, idx) => (
          <button
            key={idx}
            title={tool.label}
            style={{
              padding: '6px 10px',
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'var(--bg-hover)';
              e.target.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent';
              e.target.style.color = 'var(--text-secondary)';
            }}
          >
            {tool.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
