import ModeSelector from './ModeSelector';
import ToolSelector from './ToolSelector';

export default function Toolbar({ 
  viewMode, 
  onViewModeChange, 
  isExploded, 
  onExplodeToggle,
  currentMode,
  onModeChange,
  activeTool,
  onToolChange,
  showGrid,
  onGridToggle,
  showSnap,
  onSnapToggle,
}) {
  const viewModes = [
    { id: 'solid', label: 'Solid', icon: '◼' },
    { id: 'wireframe', label: 'Wireframe', icon: '▢' },
  ];

  return (
    <div style={{
      display: 'flex',
      gap: '6px',
      padding: '4px 8px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)',
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      {/* Mode Selector */}
      <ModeSelector currentMode={currentMode} onModeChange={onModeChange} />

      {/* Separator */}
      <div style={{
        width: '1px',
        height: '20px',
        background: 'var(--border-color)',
      }} />

      {/* Tool Selector */}
      <ToolSelector 
        currentMode={currentMode} 
        activeTool={activeTool} 
        onToolChange={onToolChange} 
      />

      {/* Separator */}
      <div style={{
        width: '1px',
        height: '20px',
        background: 'var(--border-color)',
      }} />

      {/* View mode selector */}
      <div style={{
        display: 'flex',
        gap: '2px',
        background: 'var(--bg-tertiary)',
        borderRadius: '4px',
        padding: '2px',
      }}>
        {viewModes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onViewModeChange(mode.id)}
            style={{
              padding: '3px 8px',
              background: viewMode === mode.id ? 'var(--accent-orange)' : 'transparent',
              border: 'none',
              borderRadius: '3px',
              color: viewMode === mode.id ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: viewMode === mode.id ? '500' : 'normal',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (viewMode !== mode.id) {
                e.target.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (viewMode !== mode.id) {
                e.target.style.background = 'transparent';
              }
            }}
          >
            <span>{mode.icon}</span>
            <span>{mode.label}</span>
          </button>
        ))}
      </div>

      {/* Explode view toggle */}
      <button
        onClick={onExplodeToggle}
        style={{
          padding: '3px 8px',
          background: isExploded ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: isExploded ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '10px',
          fontWeight: isExploded ? '500' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          transition: 'all 0.15s',
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

      {/* Grid toggle */}
      <button
        onClick={onGridToggle}
        style={{
          padding: '3px 8px',
          background: showGrid ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: showGrid ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '10px',
          fontWeight: showGrid ? '500' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!showGrid) {
            e.target.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!showGrid) {
            e.target.style.background = 'var(--bg-tertiary)';
          }
        }}
      >
        <span>#</span>
        <span>Grid</span>
      </button>

      {/* Snap toggle */}
      <button
        onClick={onSnapToggle}
        style={{
          padding: '3px 8px',
          background: showSnap ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: showSnap ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '10px',
          fontWeight: showSnap ? '500' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!showSnap) {
            e.target.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!showSnap) {
            e.target.style.background = 'var(--bg-tertiary)';
          }
        }}
      >
        <span>🧲</span>
        <span>Snap</span>
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Help text */}
      <div style={{
        fontSize: '10px',
        color: 'var(--text-secondary)',
      }}>
        {activeTool ? `${activeTool} tool active` : 'Select a tool or object'}
      </div>
    </div>
  );
}
