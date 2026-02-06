import { useState, useRef, useEffect } from 'react';
import './Topbar.css';

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
        { label: 'Primitives', disabled: false, isCategory: true },
        { label: 'Box', shortcut: 'Shift+B', action: () => console.log('Box'), indent: true },
        { label: 'Sphere', shortcut: 'Shift+S', action: () => console.log('Sphere'), indent: true },
        { label: 'Cylinder', shortcut: 'Shift+C', action: () => console.log('Cylinder'), indent: true },
        { label: 'Cone', action: () => console.log('Cone'), indent: true },
        { label: 'Torus', action: () => console.log('Torus'), indent: true },
        { label: 'Plane', action: () => console.log('Plane'), indent: true },
        { type: 'separator' },
        { label: 'Architecture', disabled: false, isCategory: true },
        { label: 'Wall', action: () => console.log('Wall'), indent: true },
        { label: 'Door', action: () => console.log('Door'), indent: true },
        { label: 'Window', action: () => console.log('Window'), indent: true },
        { label: 'Stairs', action: () => console.log('Stairs'), indent: true },
        { label: 'Column', action: () => console.log('Column'), indent: true },
        { label: 'Beam', action: () => console.log('Beam'), indent: true },
        { type: 'separator' },
        { label: 'Furniture', disabled: false, isCategory: true },
        { label: 'Chair', action: () => console.log('Chair'), indent: true },
        { label: 'Table', action: () => console.log('Table'), indent: true },
        { label: 'Desk', action: () => console.log('Desk'), indent: true },
        { label: 'Sofa', action: () => console.log('Sofa'), indent: true },
        { label: 'Bed', action: () => console.log('Bed'), indent: true },
        { label: 'Cabinet', action: () => console.log('Cabinet'), indent: true },
        { type: 'separator' },
        { label: 'Browse Library...', action: () => console.log('Browse Library') },
        { label: 'Import Custom Asset...', action: () => console.log('Import Asset') },
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
    <div ref={menuRef} className="topbar">
      {/* App Title */}
      <div className="topbar-brand">ArchDisc</div>

      {/* Menu Items */}
      {Object.entries(menus).map(([key, menu]) => (
        <div key={key} className="topbar-menu-wrapper">
          <button
            className={`topbar-menu-trigger ${openMenu === key ? 'active' : ''}`}
            onClick={() => handleMenuClick(key)}
            onMouseEnter={() => {
              if (openMenu) handleMenuClick(key);
            }}
          >
            {menu.label}
          </button>

          {/* Dropdown Menu */}
          {openMenu === key && (
            <div className="topbar-dropdown">
              {menu.items.map((item, index) => {
                if (item.type === 'separator') {
                  return <div key={index} className="topbar-separator" />;
                }

                if (item.isCategory) {
                  return (
                    <div key={index} className="topbar-category">
                      {item.label}
                    </div>
                  );
                }

                return (
                  <div
                    key={index}
                    className={`topbar-item ${item.disabled ? 'disabled' : ''} ${item.indent ? 'indented' : ''}`}
                    onClick={() => handleItemClick(item)}
                  >
                    <div className="topbar-item-left">
                      {item.checked && <span className="topbar-check">&#10003;</span>}
                      <span>{item.label}</span>
                    </div>
                    {item.shortcut && (
                      <span className="topbar-shortcut">{item.shortcut}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Spacer */}
      <div className="topbar-spacer" />

      {/* Status indicator */}
      <div className="topbar-status">
        <div className="topbar-status-dot" />
        <span>Ready</span>
      </div>
    </div>
  );
}
