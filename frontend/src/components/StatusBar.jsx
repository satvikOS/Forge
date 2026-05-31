import './StatusBar.css';

export default function StatusBar({ mode, activeTool, selectionCount, stats }) {
  return (
    <div className="status-bar">
      {/* Left section - Mode and Tool */}
      <div className="status-bar-left">
        {mode && (
          <span className="status-bar-mode">{mode}</span>
        )}
        {activeTool && (
          <>
            <span className="status-bar-divider" />
            <span className="status-bar-tool">{activeTool}</span>
          </>
        )}
      </div>

      {/* Center section - Selection info */}
      {selectionCount && (
        <div className="status-bar-center">
          {selectionCount.vertices !== undefined && (
            <span className="status-bar-stat">Verts: <b>{selectionCount.vertices}</b></span>
          )}
          {selectionCount.edges !== undefined && (
            <span className="status-bar-stat">Edges: <b>{selectionCount.edges}</b></span>
          )}
          {selectionCount.faces !== undefined && (
            <span className="status-bar-stat">Faces: <b>{selectionCount.faces}</b></span>
          )}
          {selectionCount.objects !== undefined && (
            <span className="status-bar-stat">Objects: <b>{selectionCount.objects}</b></span>
          )}
        </div>
      )}

      {/* Right section - Stats */}
      {stats && (
        <div className="status-bar-right">
          {stats.triangles !== undefined && (
            <span className="status-bar-stat">
              Tris: <b className="monospace">{stats.triangles.toLocaleString()}</b>
            </span>
          )}
          {stats.fps !== undefined && (
            <span className={`status-bar-fps ${stats.fps > 30 ? 'good' : 'warn'}`}>
              FPS: <b className="monospace">{stats.fps}</b>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
