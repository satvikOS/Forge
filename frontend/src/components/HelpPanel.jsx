/**
 * Help Panel - Keyboard shortcuts and tool documentation
 */

import { useState } from 'react';

const ShortcutItem = ({ keys, description }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: 'var(--bg-tertiary)',
    borderRadius: '4px',
    marginBottom: '6px',
    fontSize: '12px',
  }}>
    <span style={{ color: 'var(--text-secondary)' }}>{description}</span>
    <span style={{
      padding: '4px 8px',
      background: 'var(--bg-primary)',
      borderRadius: '4px',
      fontFamily: 'monospace',
      color: 'var(--accent-orange)',
      fontWeight: 'bold',
      fontSize: '11px',
    }}>
      {keys}
    </span>
  </div>
);

const CategorySection = ({ title, shortcuts, isCollapsed, onToggle }) => (
  <div style={{ marginBottom: '16px' }}>
    <div
      onClick={onToggle}
      style={{
        padding: '8px 12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
        userSelect: 'none',
      }}
    >
      <span>{isCollapsed ? '▸' : '▾'}</span>
      <span style={{
        fontSize: '13px',
        fontWeight: 'bold',
        color: 'var(--text-primary)',
      }}>
        {title}
      </span>
    </div>
    {!isCollapsed && (
      <div>
        {shortcuts.map((shortcut, index) => (
          <ShortcutItem key={index} keys={shortcut.keys} description={shortcut.description} />
        ))}
      </div>
    )}
  </div>
);

export default function HelpPanel({ onClose }) {
  const [collapsedSections, setCollapsedSections] = useState({});

  const toggleSection = (section) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const shortcuts = {
    selection: [
      { keys: 'S', description: 'Select Tool' },
      { keys: 'B', description: 'Box Select' },
      { keys: 'C', description: 'Circle Select' },
      { keys: 'A', description: 'Select All' },
      { keys: 'Ctrl + A', description: 'Select All (Alt)' },
      { keys: 'I', description: 'Invert Selection' },
      { keys: 'Shift + Click', description: 'Add to Selection' },
      { keys: 'Ctrl + Click', description: 'Remove from Selection' },
    ],
    transform: [
      { keys: 'G', description: 'Move/Grab' },
      { keys: 'R', description: 'Rotate' },
      { keys: 'S', description: 'Scale' },
      { keys: 'X/Y/Z', description: 'Lock to Axis (after G/R/S)' },
      { keys: 'Shift + D', description: 'Duplicate' },
      { keys: 'Ctrl + M', description: 'Mirror' },
      { keys: 'Delete', description: 'Delete Selected' },
      { keys: 'Escape', description: 'Cancel Operation' },
    ],
    modeling: [
      { keys: 'E', description: 'Extrude' },
      { keys: 'P', description: 'Push/Pull' },
      { keys: 'Ctrl + B', description: 'Bevel' },
      { keys: '+/-', description: 'Adjust Parameter (during operation)' },
    ],
    drawing: [
      { keys: 'L', description: 'Line Tool' },
      { keys: 'Shift + R', description: 'Rectangle Tool' },
      { keys: 'Shift + C', description: 'Circle Tool' },
      { keys: 'Shift + P', description: 'Polygon Tool' },
      { keys: 'Enter', description: 'Finish Polygon/Line' },
      { keys: 'Right Click', description: 'Finish Drawing' },
    ],
    measurement: [
      { keys: 'M', description: 'Tape Measure' },
      { keys: 'C (in tool)', description: 'Clear Measurements' },
    ],
    camera: [
      { keys: 'F', description: 'Focus on Selection' },
      { keys: 'Home', description: 'Frame All Objects' },
      { keys: 'Mouse Wheel', description: 'Zoom In/Out' },
      { keys: 'Middle Mouse + Drag', description: 'Pan View' },
      { keys: 'Right Mouse + Drag', description: 'Rotate View' },
    ],
    editing: [
      { keys: 'Ctrl + Z', description: 'Undo' },
      { keys: 'Ctrl + Shift + Z', description: 'Redo' },
      { keys: 'Ctrl + C', description: 'Copy (planned)' },
      { keys: 'Ctrl + V', description: 'Paste (planned)' },
    ],
    file: [
      { keys: 'Ctrl + S', description: 'Save Project (planned)' },
      { keys: 'Ctrl + O', description: 'Open Project (planned)' },
      { keys: 'Ctrl + E', description: 'Export (planned)' },
    ],
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '800px',
        maxHeight: '90vh',
        background: 'var(--bg-primary)',
        borderRadius: '12px',
        border: '2px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '2px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: '24px',
              color: 'var(--text-primary)',
              fontWeight: 'bold',
            }}>
              ArchDisc 3D Editor
            </h2>
            <p style={{
              margin: '8px 0 0 0',
              fontSize: '14px',
              color: 'var(--text-secondary)',
            }}>
              Keyboard Shortcuts & Tool Guide
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Close (Esc)
          </button>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
        }}>
          {/* Quick Tips */}
          <div style={{
            padding: '16px',
            background: 'var(--accent-orange)',
            borderRadius: '8px',
            marginBottom: '24px',
          }}>
            <h3 style={{
              margin: '0 0 12px 0',
              fontSize: '16px',
              color: 'white',
              fontWeight: 'bold',
            }}>
              💡 Quick Tips
            </h3>
            <ul style={{
              margin: 0,
              paddingLeft: '20px',
              color: 'white',
              fontSize: '13px',
              lineHeight: '1.8',
            }}>
              <li>Use the toolbar on the left to access all tools organized by category</li>
              <li>Press keyboard shortcuts for quick access to frequently used tools</li>
              <li>Most operations can be canceled with <strong>Escape</strong></li>
              <li>Hold <strong>Shift</strong> to add to selection, <strong>Ctrl</strong> to remove</li>
              <li>After pressing G/R/S, press X/Y/Z to constrain to an axis</li>
              <li>Right-click in the scene to deselect all objects</li>
            </ul>
          </div>

          {/* Shortcuts by Category */}
          <CategorySection
            title="Selection Tools"
            shortcuts={shortcuts.selection}
            isCollapsed={collapsedSections.selection}
            onToggle={() => toggleSection('selection')}
          />

          <CategorySection
            title="Transform Tools"
            shortcuts={shortcuts.transform}
            isCollapsed={collapsedSections.transform}
            onToggle={() => toggleSection('transform')}
          />

          <CategorySection
            title="Modeling Tools"
            shortcuts={shortcuts.modeling}
            isCollapsed={collapsedSections.modeling}
            onToggle={() => toggleSection('modeling')}
          />

          <CategorySection
            title="Drawing Tools"
            shortcuts={shortcuts.drawing}
            isCollapsed={collapsedSections.drawing}
            onToggle={() => toggleSection('drawing')}
          />

          <CategorySection
            title="Measurement Tools"
            shortcuts={shortcuts.measurement}
            isCollapsed={collapsedSections.measurement}
            onToggle={() => toggleSection('measurement')}
          />

          <CategorySection
            title="Camera Navigation"
            shortcuts={shortcuts.camera}
            isCollapsed={collapsedSections.camera}
            onToggle={() => toggleSection('camera')}
          />

          <CategorySection
            title="Editing"
            shortcuts={shortcuts.editing}
            isCollapsed={collapsedSections.editing}
            onToggle={() => toggleSection('editing')}
          />

          <CategorySection
            title="File Operations"
            shortcuts={shortcuts.file}
            isCollapsed={collapsedSections.file}
            onToggle={() => toggleSection('file')}
          />

          {/* Additional Info */}
          <div style={{
            marginTop: '24px',
            padding: '16px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            lineHeight: '1.6',
          }}>
            <p style={{ margin: '0 0 8px 0' }}>
              <strong style={{ color: 'var(--text-primary)' }}>About ArchDisc:</strong>
            </p>
            <p style={{ margin: 0 }}>
              ArchDisc is a comprehensive 3D design application combining AI-powered design generation
              with professional-grade manual 3D editing tools. Switch between modes using the toggle in
              the header to access AI design generation or the full 3D editor.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
