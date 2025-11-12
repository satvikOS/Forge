import { useState, useRef, useEffect } from 'react';

export default function Topbar() {
  const [openMenu, setOpenMenu] = useState(null);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menus = {
    file: {
      label: 'File',
      items: [
        { label: 'New', shortcut: 'Ctrl+N', action: () => console.log('New') },
        { label: 'Open', shortcut: 'Ctrl+O', action: () => console.log('Open') },
        { label: 'Save', shortcut: 'Ctrl+S', action: () => console.log('Save') },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: () => console.log('Save As') },
        { type: 'separator' },
        { label: 'Import...', action: () => console.log('Import') },
        { label: 'Export...', shortcut: 'Ctrl+E', action: () => console.log('Export') },
        { type: 'separator' },
        { label: 'Recent Files', disabled: true },
        { type: 'separator' },
        { label: 'Exit', shortcut: 'Alt+F4', action: () => console.log('Exit') },
      ],
    },
    edit: {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => console.log('Undo') },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => console.log('Redo') },
        { type: 'separator' },
        { label: 'Cut', shortcut: 'Ctrl+X', action: () => console.log('Cut') },
        { label: 'Copy', shortcut: 'Ctrl+C', action: () => console.log('Copy') },
        { label: 'Paste', shortcut: 'Ctrl+V', action: () => console.log('Paste') },
        { label: 'Delete', shortcut: 'Del', action: () => console.log('Delete') },
        { type: 'separator' },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => console.log('Select All') },
        { label: 'Deselect All', shortcut: 'Ctrl+D', action: () => console.log('Deselect All') },
        { type: 'separator' },
        { label: 'Preferences...', action: () => console.log('Preferences') },
      ],
    },
    view: {
      label: 'View',
      items: [
        { label: 'Zoom In', shortcut: 'Ctrl++', action: () => console.log('Zoom In') },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => console.log('Zoom Out') },
        { label: 'Reset Zoom', shortcut: 'Ctrl+0', action: () => console.log('Reset Zoom') },
        { type: 'separator' },
        { label: 'Frame All', shortcut: 'Home', action: () => console.log('Frame All') },
        { label: 'Frame Selection', shortcut: 'F', action: () => console.log('Frame Selection') },
        { type: 'separator' },
        { label: 'Grid', shortcut: 'G', action: () => console.log('Grid'), checked: true },
        { label: 'Guides', shortcut: 'Ctrl+;', action: () => console.log('Guides') },
        { label: 'Axes', shortcut: 'Ctrl+Shift+A', action: () => console.log('Axes'), checked: true },
        { type: 'separator' },
        { label: 'Wireframe Mode', shortcut: 'Z', action: () => console.log('Wireframe') },
        { label: 'Solid Mode', shortcut: 'Shift+Z', action: () => console.log('Solid') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', shortcut: 'Tab', action: () => console.log('Toggle Sidebar') },
        { label: 'Full Screen', shortcut: 'F11', action: () => console.log('Full Screen') },
      ],
    },
    tools: {
      label: 'Tools',
      items: [
        { label: 'Select Tool', shortcut: 'S', action: () => console.log('Select') },
        { label: 'Move Tool', shortcut: 'M', action: () => console.log('Move') },
        { label: 'Rotate Tool', shortcut: 'R', action: () => console.log('Rotate') },
        { label: 'Scale Tool', shortcut: 'E', action: () => console.log('Scale') },
        { type: 'separator' },
        { label: 'Draw Box', shortcut: 'B', action: () => console.log('Box') },
        { label: 'Draw Cylinder', shortcut: 'C', action: () => console.log('Cylinder') },
        { label: 'Draw Sphere', shortcut: 'Shift+S', action: () => console.log('Sphere') },
        { type: 'separator' },
        { label: 'Measure Distance', shortcut: 'Ctrl+M', action: () => console.log('Measure') },
        { label: 'Measure Angle', action: () => console.log('Angle') },
        { type: 'separator' },
        { label: 'Exploded View', shortcut: 'X', action: () => console.log('Explode') },
        { label: 'Analyze Design', shortcut: 'Ctrl+Shift+A', action: () => console.log('Analyze') },
      ],
    },
    assets: {
      label: '3D Assets',
      items: [
        { label: '📦 Primitives', disabled: false },
        { label: '  Box', shortcut: 'Shift+B', action: () => console.log('Box') },
        { label: '  Sphere', shortcut: 'Shift+S', action: () => console.log('Sphere') },
        { label: '  Cylinder', shortcut: 'Shift+C', action: () => console.log('Cylinder') },
        { label: '  Cone', action: () => console.log('Cone') },
        { label: '  Torus', action: () => console.log('Torus') },
        { label: '  Plane', action: () => console.log('Plane') },
        { type: 'separator' },
        { label: '🏢 Architecture', disabled: false },
        { label: '  Wall', action: () => console.log('Wall') },
        { label: '  Door', action: () => console.log('Door') },
        { label: '  Window', action: () => console.log('Window') },
        { label: '  Stairs', action: () => console.log('Stairs') },
        { label: '  Column', action: () => console.log('Column') },
        { label: '  Beam', action: () => console.log('Beam') },
        { type: 'separator' },
        { label: '🪑 Furniture', disabled: false },
        { label: '  Chair', action: () => console.log('Chair') },
        { label: '  Table', action: () => console.log('Table') },
        { label: '  Desk', action: () => console.log('Desk') },
        { label: '  Sofa', action: () => console.log('Sofa') },
        { label: '  Bed', action: () => console.log('Bed') },
        { label: '  Cabinet', action: () => console.log('Cabinet') },
        { type: 'separator' },
        { label: '🚗 Vehicles', disabled: false },
        { label: '  Car', action: () => console.log('Car') },
        { label: '  Truck', action: () => console.log('Truck') },
        { label: '  Bike', action: () => console.log('Bike') },
        { label: '  Motorcycle', action: () => console.log('Motorcycle') },
        { type: 'separator' },
        { label: '💡 Electronics', disabled: false },
        { label: '  Smartphone', action: () => console.log('Smartphone') },
        { label: '  Laptop', action: () => console.log('Laptop') },
        { label: '  Monitor', action: () => console.log('Monitor') },
        { label: '  Speaker', action: () => console.log('Speaker') },
        { type: 'separator' },
        { label: '🌳 Nature', disabled: false },
        { label: '  Tree', action: () => console.log('Tree') },
        { label: '  Bush', action: () => console.log('Bush') },
        { label: '  Rock', action: () => console.log('Rock') },
        { label: '  Grass', action: () => console.log('Grass') },
        { type: 'separator' },
        { label: '📚 Browse Library...', action: () => console.log('Browse Library') },
        { label: '⬇️  Import Custom Asset...', action: () => console.log('Import Asset') },
      ],
    },
    help: {
      label: 'Help',
      items: [
        { label: 'Documentation', shortcut: 'F1', action: () => console.log('Documentation') },
        { label: 'Keyboard Shortcuts', shortcut: 'Ctrl+/', action: () => console.log('Shortcuts') },
        { label: 'Video Tutorials', action: () => console.log('Tutorials') },
        { type: 'separator' },
        { label: 'Report Bug', action: () => console.log('Report Bug') },
        { label: 'Feature Request', action: () => console.log('Feature Request') },
        { type: 'separator' },
        { label: 'About ArchDisc', action: () => console.log('About') },
        { label: 'Check for Updates', action: () => console.log('Updates') },
      ],
    },
  };

  const handleMenuClick = (menuKey) => {
    setOpenMenu(openMenu === menuKey ? null : menuKey);
  };

  const handleItemClick = (item) => {
    if (!item.disabled && item.action) {
      item.action();
      setOpenMenu(null);
    }
  };

  return (
    <div
      ref={menuRef}
      style={{
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        height: '36px',
        padding: '0 10px',
        userSelect: 'none',
        position: 'relative',
        zIndex: 100,
      }}
    >
      {/* App Title */}
      <div
        style={{
          fontSize: '14px',
          fontWeight: 'bold',
          color: 'var(--text-primary)',
          marginRight: '20px',
          padding: '0 10px',
        }}
      >
        ArchDisc
      </div>

      {/* Menu Items */}
      {Object.entries(menus).map(([key, menu]) => (
        <div key={key} style={{ position: 'relative' }}>
          <button
            onClick={() => handleMenuClick(key)}
            style={{
              background: openMenu === key ? 'var(--bg-hover)' : 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              padding: '8px 12px',
              fontSize: '13px',
              cursor: 'pointer',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              if (!openMenu) return;
              handleMenuClick(key);
            }}
          >
            {menu.label}
          </button>

          {/* Dropdown Menu */}
          {openMenu === key && (
            <div
              style={{
                position: 'absolute',
                top: '36px',
                left: 0,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                minWidth: '220px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                zIndex: 1000,
                padding: '4px 0',
              }}
            >
              {menu.items.map((item, index) => {
                if (item.type === 'separator') {
                  return (
                    <div
                      key={index}
                      style={{
                        height: '1px',
                        background: 'var(--border-color)',
                        margin: '4px 8px',
                      }}
                    />
                  );
                }

                return (
                  <div
                    key={index}
                    onClick={() => handleItemClick(item)}
                    style={{
                      padding: '8px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: item.disabled ? 'not-allowed' : 'pointer',
                      color: item.disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
                      fontSize: '13px',
                      background: 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!item.disabled) {
                        e.currentTarget.style.background = 'var(--bg-hover)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {item.checked && <span style={{ color: 'var(--accent-orange)' }}>✓</span>}
                      <span>{item.label}</span>
                    </div>
                    {item.shortcut && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginLeft: '20px',
                        }}
                      >
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Status indicator */}
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '0 10px',
        }}
      >
        <div
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#4caf50',
          }}
        />
        <span>Ready</span>
      </div>
    </div>
  );
}
