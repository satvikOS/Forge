export default function Toolbar({ viewMode, onViewModeChange, isExploded, onExplodeToggle }) {
  const tools = [
    { id: 'solid', label: 'Solid', icon: '◼' },
    { id: 'wireframe', label: 'Wireframe', icon: '▢' },
  ];

  return (
    <div style={{
      display: 'flex',
      gap: '10px',
      padding: '10px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)',
      alignItems: 'center',
    }}>
      {/* View mode selector */}
      <div style={{
        display: 'flex',
        gap: '5px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        padding: '4px',
      }}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onViewModeChange(tool.id)}
            style={{
              padding: '8px 16px',
              background: viewMode === tool.id ? 'var(--accent-orange)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: viewMode === tool.id ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: viewMode === tool.id ? 'bold' : 'normal',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
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
        height: '30px',
        background: 'var(--border-color)',
      }} />

      {/* Explode view toggle */}
      <button
        onClick={onExplodeToggle}
        style={{
          padding: '8px 16px',
          background: isExploded ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          color: isExploded ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: isExploded ? 'bold' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
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
        <span>Explode View</span>
      </button>

      {/* Separator */}
      <div style={{
        width: '1px',
        height: '30px',
        background: 'var(--border-color)',
      }} />

      {/* Render button (placeholder) */}
      <button
        disabled
        style={{
          padding: '8px 16px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          color: 'var(--text-disabled)',
          cursor: 'not-allowed',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          opacity: 0.5,
        }}
      >
        <span>🎨</span>
        <span>Render (Coming Soon)</span>
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Help text */}
      <div style={{
        fontSize: '12px',
        color: 'var(--text-secondary)',
        fontStyle: 'italic',
      }}>
        Click on parts to select and edit them individually
      </div>
    </div>
  );
}
