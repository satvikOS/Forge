export default function StatusBar({ mode, activeTool, selectionCount, stats }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 12px',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-color)',
        fontSize: '12px',
        color: 'var(--text-secondary)',
        height: '28px',
      }}
    >
      {/* Left section - Mode and Tool */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {mode && (
          <span style={{ color: 'var(--accent-orange)', fontWeight: '500' }}>
            {mode}
          </span>
        )}
        {activeTool && (
          <>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>{activeTool}</span>
          </>
        )}
      </div>

      {/* Center section - Selection info */}
      {selectionCount && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {selectionCount.vertices !== undefined && (
            <span>Verts: {selectionCount.vertices}</span>
          )}
          {selectionCount.edges !== undefined && (
            <span>Edges: {selectionCount.edges}</span>
          )}
          {selectionCount.faces !== undefined && (
            <span>Faces: {selectionCount.faces}</span>
          )}
          {selectionCount.objects !== undefined && (
            <span>Objects: {selectionCount.objects}</span>
          )}
        </div>
      )}

      {/* Right section - Stats */}
      {stats && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {stats.triangles !== undefined && (
            <span>Tris: {stats.triangles.toLocaleString()}</span>
          )}
          {stats.fps !== undefined && (
            <span>FPS: {stats.fps}</span>
          )}
        </div>
      )}
    </div>
  );
}
