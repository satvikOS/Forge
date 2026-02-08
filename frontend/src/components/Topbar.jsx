import { useState, useRef, useEffect } from 'react';
import './Topbar.css';

/**
 * Topbar - Application menu bar with full nested submenu support
 * Supports: flat items, separators, categories, and nested submenus (arrow indicator)
 */
export default function Topbar() {
  const [openMenu, setOpenMenu] = useState(null);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpenMenu(null);
        setOpenSubmenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const menus = {
    file: {
      label: 'File',
      items: [
        { label: 'New Project', shortcut: 'Ctrl+N', action: () => console.log('New') },
        { label: 'New Part', action: () => console.log('New Part') },
        { label: 'New Assembly', action: () => console.log('New Assembly') },
        { label: 'New Drawing', action: () => console.log('New Drawing') },
        { type: 'separator' },
        { label: 'Open', shortcut: 'Ctrl+O', action: () => console.log('Open') },
        { label: 'Save', shortcut: 'Ctrl+S', action: () => console.log('Save') },
        { label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: () => console.log('Save As') },
        { label: 'Save All', action: () => console.log('Save All') },
        { type: 'separator' },
        { label: 'Import', submenu: [
          { label: 'STEP (.stp, .step)', action: () => console.log('Import STEP') },
          { label: 'IGES (.igs, .iges)', action: () => console.log('Import IGES') },
          { label: 'Parasolid (.x_t, .x_b)', action: () => console.log('Import Parasolid') },
          { label: 'STL (.stl)', action: () => console.log('Import STL') },
          { label: 'OBJ (.obj)', action: () => console.log('Import OBJ') },
          { label: 'FBX (.fbx)', action: () => console.log('Import FBX') },
          { label: 'glTF/GLB', action: () => console.log('Import glTF') },
          { label: 'DXF/DWG', action: () => console.log('Import DXF') },
          { label: 'JT (.jt)', action: () => console.log('Import JT') },
          { label: 'CATIA V5 (.CATpart)', action: () => console.log('Import CATIA') },
          { label: 'NX (.prt)', action: () => console.log('Import NX') },
          { label: 'Creo/Pro-E (.prt)', action: () => console.log('Import Creo') },
          { label: 'Inventor (.ipt)', action: () => console.log('Import Inventor') },
        ]},
        { label: 'Export', submenu: [
          { label: 'STEP (.step)', action: () => console.log('Export STEP') },
          { label: 'IGES (.iges)', action: () => console.log('Export IGES') },
          { label: 'Parasolid (.x_t)', action: () => console.log('Export Parasolid') },
          { label: 'STL (.stl)', action: () => console.log('Export STL') },
          { label: '3MF (.3mf)', action: () => console.log('Export 3MF') },
          { label: 'OBJ (.obj)', action: () => console.log('Export OBJ') },
          { label: 'FBX (.fbx)', action: () => console.log('Export FBX') },
          { label: 'glTF/GLB', action: () => console.log('Export glTF') },
          { label: 'DXF (.dxf)', action: () => console.log('Export DXF') },
          { label: 'DWG (.dwg)', action: () => console.log('Export DWG') },
          { label: 'PDF Drawing', action: () => console.log('Export PDF') },
          { label: '3D PDF', action: () => console.log('Export 3D PDF') },
          { label: 'JT (.jt)', action: () => console.log('Export JT') },
        ]},
        { type: 'separator' },
        { label: 'Pack and Go', action: () => console.log('Pack and Go') },
        { label: 'Recent Files', disabled: true },
        { type: 'separator' },
        { label: 'Properties', action: () => console.log('Properties') },
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
        { label: 'Paste Special', action: () => console.log('Paste Special') },
        { label: 'Delete', shortcut: 'Del', action: () => console.log('Delete') },
        { type: 'separator' },
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => console.log('Select All') },
        { label: 'Deselect All', shortcut: 'Ctrl+D', action: () => console.log('Deselect All') },
        { label: 'Invert Selection', action: () => console.log('Invert Selection') },
        { type: 'separator' },
        { label: 'Find / Replace', shortcut: 'Ctrl+F', action: () => console.log('Find') },
        { label: 'Suppress Feature', action: () => console.log('Suppress') },
        { label: 'Unsuppress Feature', action: () => console.log('Unsuppress') },
        { type: 'separator' },
        { label: 'Preferences...', action: () => console.log('Preferences') },
      ],
    },
    view: {
      label: 'View',
      items: [
        { label: 'Standard Views', submenu: [
          { label: 'Front', shortcut: 'Num 1', action: () => console.log('Front') },
          { label: 'Back', shortcut: 'Ctrl+1', action: () => console.log('Back') },
          { label: 'Top', shortcut: 'Num 7', action: () => console.log('Top') },
          { label: 'Bottom', shortcut: 'Ctrl+7', action: () => console.log('Bottom') },
          { label: 'Left', shortcut: 'Ctrl+3', action: () => console.log('Left') },
          { label: 'Right', shortcut: 'Num 3', action: () => console.log('Right') },
          { label: 'Isometric', shortcut: 'Num 0', action: () => console.log('Isometric') },
          { label: 'Dimetric', action: () => console.log('Dimetric') },
          { label: 'Trimetric', action: () => console.log('Trimetric') },
        ]},
        { label: 'Display Style', submenu: [
          { label: 'Wireframe', shortcut: 'Z', action: () => console.log('Wireframe') },
          { label: 'Hidden Lines Visible', action: () => console.log('HLV') },
          { label: 'Hidden Lines Removed', action: () => console.log('HLR') },
          { label: 'Shaded', shortcut: 'Shift+Z', action: () => console.log('Shaded') },
          { label: 'Shaded with Edges', action: () => console.log('Shaded Edges') },
          { label: 'Draft Quality', action: () => console.log('Draft Quality') },
        ]},
        { type: 'separator' },
        { label: 'Zoom In', shortcut: 'Ctrl++', action: () => console.log('Zoom In') },
        { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => console.log('Zoom Out') },
        { label: 'Zoom to Fit', shortcut: 'Home', action: () => console.log('Zoom Fit') },
        { label: 'Zoom to Selection', shortcut: 'F', action: () => console.log('Zoom Selection') },
        { type: 'separator' },
        { label: 'Section View', action: () => console.log('Section View') },
        { label: 'Perspective', action: () => console.log('Perspective'), checked: true },
        { type: 'separator' },
        { label: 'Show/Hide', submenu: [
          { label: 'Grid', shortcut: 'G', action: () => console.log('Grid'), checked: true },
          { label: 'Axes', action: () => console.log('Axes'), checked: true },
          { label: 'Origin', action: () => console.log('Origin') },
          { label: 'Sketches', action: () => console.log('Sketches'), checked: true },
          { label: 'Planes', action: () => console.log('Planes') },
          { label: 'Reference Geometry', action: () => console.log('Ref Geom') },
          { label: 'Feature Tree', action: () => console.log('Feature Tree') },
        ]},
        { type: 'separator' },
        { label: 'Toggle Sidebar', shortcut: 'Tab', action: () => console.log('Toggle Sidebar') },
        { label: 'Full Screen', shortcut: 'F11', action: () => console.log('Full Screen') },
      ],
    },
    insert: {
      label: 'Insert',
      items: [
        { label: 'Sketch', submenu: [
          { label: 'New Sketch', action: () => console.log('New Sketch') },
          { label: 'Sketch on Face', action: () => console.log('Sketch on Face') },
          { label: '3D Sketch', action: () => console.log('3D Sketch') },
        ]},
        { label: 'Boss/Base', submenu: [
          { label: 'Extrude', action: () => console.log('Extrude Boss') },
          { label: 'Revolve', action: () => console.log('Revolve Boss') },
          { label: 'Sweep', action: () => console.log('Sweep Boss') },
          { label: 'Loft', action: () => console.log('Loft Boss') },
          { label: 'Boundary', action: () => console.log('Boundary Boss') },
        ]},
        { label: 'Cut', submenu: [
          { label: 'Extrude Cut', action: () => console.log('Extrude Cut') },
          { label: 'Revolve Cut', action: () => console.log('Revolve Cut') },
          { label: 'Sweep Cut', action: () => console.log('Sweep Cut') },
          { label: 'Loft Cut', action: () => console.log('Loft Cut') },
        ]},
        { type: 'separator' },
        { label: 'Features', submenu: [
          { label: 'Fillet', action: () => console.log('Fillet') },
          { label: 'Chamfer', action: () => console.log('Chamfer') },
          { label: 'Shell', action: () => console.log('Shell') },
          { label: 'Draft', action: () => console.log('Draft') },
          { label: 'Rib', action: () => console.log('Rib') },
          { label: 'Wrap', action: () => console.log('Wrap') },
          { label: 'Dome', action: () => console.log('Dome') },
        ]},
        { label: 'Hole Wizard', action: () => console.log('Hole Wizard') },
        { label: 'Thread', action: () => console.log('Thread') },
        { type: 'separator' },
        { label: 'Pattern', submenu: [
          { label: 'Linear Pattern', action: () => console.log('Linear Pattern') },
          { label: 'Circular Pattern', action: () => console.log('Circular Pattern') },
          { label: 'Mirror', action: () => console.log('Mirror') },
          { label: 'Curve-Driven Pattern', action: () => console.log('Curve Pattern') },
          { label: 'Fill Pattern', action: () => console.log('Fill Pattern') },
        ]},
        { type: 'separator' },
        { label: 'Reference Geometry', submenu: [
          { label: 'Plane', action: () => console.log('Ref Plane') },
          { label: 'Axis', action: () => console.log('Ref Axis') },
          { label: 'Point', action: () => console.log('Ref Point') },
          { label: 'Coordinate System', action: () => console.log('Coord System') },
          { label: 'Center of Mass', action: () => console.log('CoM') },
        ]},
        { label: 'Curves', submenu: [
          { label: 'Helix/Spiral', action: () => console.log('Helix') },
          { label: 'Composite Curve', action: () => console.log('Composite Curve') },
          { label: 'Projected Curve', action: () => console.log('Projected Curve') },
          { label: 'Split Line', action: () => console.log('Split Line') },
        ]},
        { type: 'separator' },
        { label: 'Surface', submenu: [
          { label: 'Extrude Surface', action: () => console.log('Extrude Surface') },
          { label: 'Revolve Surface', action: () => console.log('Revolve Surface') },
          { label: 'Sweep Surface', action: () => console.log('Sweep Surface') },
          { label: 'Loft Surface', action: () => console.log('Loft Surface') },
          { label: 'Fill Surface', action: () => console.log('Fill Surface') },
          { label: 'Offset Surface', action: () => console.log('Offset Surface') },
          { label: 'Trim Surface', action: () => console.log('Trim Surface') },
          { label: 'Thicken', action: () => console.log('Thicken') },
          { label: 'Knit Surface', action: () => console.log('Knit Surface') },
        ]},
        { label: 'Sheet Metal', submenu: [
          { label: 'Base Flange', action: () => console.log('Base Flange') },
          { label: 'Edge Flange', action: () => console.log('Edge Flange') },
          { label: 'Miter Flange', action: () => console.log('Miter Flange') },
          { label: 'Hem', action: () => console.log('Hem') },
          { label: 'Fold', action: () => console.log('Fold') },
          { label: 'Unfold', action: () => console.log('Unfold') },
          { label: 'Flat Pattern', action: () => console.log('Flat Pattern') },
        ]},
        { label: 'Weldments', submenu: [
          { label: 'Structural Member', action: () => console.log('Structural Member') },
          { label: 'End Cap', action: () => console.log('End Cap') },
          { label: 'Gusset', action: () => console.log('Gusset') },
          { label: 'Weld Bead', action: () => console.log('Weld Bead') },
          { label: 'Cut List', action: () => console.log('Cut List') },
        ]},
      ],
    },
    tools: {
      label: 'Tools',
      items: [
        { label: 'Measure', submenu: [
          { label: 'Distance', shortcut: 'Ctrl+M', action: () => console.log('Distance') },
          { label: 'Angle', action: () => console.log('Angle') },
          { label: 'Radius', action: () => console.log('Radius') },
          { label: 'Area', action: () => console.log('Area') },
          { label: 'Volume', action: () => console.log('Volume') },
        ]},
        { label: 'Mass Properties', action: () => console.log('Mass Properties') },
        { label: 'Check Geometry', action: () => console.log('Check Geometry') },
        { type: 'separator' },
        { label: 'Equations', action: () => console.log('Equations') },
        { label: 'Design Table', action: () => console.log('Design Table') },
        { type: 'separator' },
        { label: 'Interference Detection', action: () => console.log('Interference') },
        { label: 'Clearance Verification', action: () => console.log('Clearance') },
        { label: 'Draft Analysis', action: () => console.log('Draft Analysis') },
        { label: 'Undercut Analysis', action: () => console.log('Undercut') },
        { label: 'Wall Thickness', action: () => console.log('Wall Thickness') },
        { type: 'separator' },
        { label: 'Compare', submenu: [
          { label: 'Compare Part', action: () => console.log('Compare Part') },
          { label: 'Compare Drawing', action: () => console.log('Compare Drawing') },
          { label: 'Compare BOM', action: () => console.log('Compare BOM') },
        ]},
        { type: 'separator' },
        { label: 'Exploded View', shortcut: 'X', action: () => console.log('Explode') },
        { label: 'Section View', action: () => console.log('Section View') },
        { label: 'Appearance', action: () => console.log('Appearance') },
      ],
    },
    assets: {
      label: '3D Assets',
      items: [
        { label: 'Primitives', submenu: [
          { label: 'Box', shortcut: 'Shift+B', action: () => console.log('Box') },
          { label: 'Sphere', shortcut: 'Shift+S', action: () => console.log('Sphere') },
          { label: 'Cylinder', shortcut: 'Shift+C', action: () => console.log('Cylinder') },
          { label: 'Cone', action: () => console.log('Cone') },
          { label: 'Torus', action: () => console.log('Torus') },
          { label: 'Plane', action: () => console.log('Plane') },
          { label: 'Wedge', action: () => console.log('Wedge') },
          { label: 'Pipe', action: () => console.log('Pipe') },
        ]},
        { label: 'Standard Parts', submenu: [
          { label: 'Hex Bolt', action: () => console.log('Hex Bolt') },
          { label: 'Socket Head Cap Screw', action: () => console.log('SHCS') },
          { label: 'Hex Nut', action: () => console.log('Hex Nut') },
          { label: 'Flat Washer', action: () => console.log('Flat Washer') },
          { label: 'Lock Washer', action: () => console.log('Lock Washer') },
          { label: 'Dowel Pin', action: () => console.log('Dowel Pin') },
          { label: 'Retaining Ring', action: () => console.log('Retaining Ring') },
          { label: 'Key / Keyway', action: () => console.log('Key') },
          { label: 'O-Ring', action: () => console.log('O-Ring') },
        ]},
        { label: 'Bearings', submenu: [
          { label: 'Ball Bearing', action: () => console.log('Ball Bearing') },
          { label: 'Roller Bearing', action: () => console.log('Roller Bearing') },
          { label: 'Thrust Bearing', action: () => console.log('Thrust Bearing') },
          { label: 'Linear Bearing', action: () => console.log('Linear Bearing') },
        ]},
        { label: 'Structural Profiles', submenu: [
          { label: 'I-Beam', action: () => console.log('I-Beam') },
          { label: 'C-Channel', action: () => console.log('C-Channel') },
          { label: 'L-Angle', action: () => console.log('L-Angle') },
          { label: 'T-Section', action: () => console.log('T-Section') },
          { label: 'Rectangular Tube', action: () => console.log('Rect Tube') },
          { label: 'Round Tube', action: () => console.log('Round Tube') },
        ]},
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
    setOpenSubmenu(null);
  };

  const handleItemClick = (item) => {
    if (!item.disabled && item.action) {
      item.action();
      setOpenMenu(null);
      setOpenSubmenu(null);
    }
  };

  const renderMenuItem = (item, index, parentKey) => {
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

    // Item with submenu
    if (item.submenu) {
      const submenuKey = `${parentKey}-${index}`;
      return (
        <div
          key={index}
          className="topbar-item has-submenu"
          onMouseEnter={() => setOpenSubmenu(submenuKey)}
          onMouseLeave={() => setOpenSubmenu(null)}
        >
          <div className="topbar-item-left">
            <span>{item.label}</span>
          </div>
          <span className="topbar-submenu-arrow">&#9656;</span>

          {openSubmenu === submenuKey && (
            <div className="topbar-submenu">
              {item.submenu.map((subItem, subIndex) => {
                if (subItem.type === 'separator') {
                  return <div key={subIndex} className="topbar-separator" />;
                }
                return (
                  <div
                    key={subIndex}
                    className={`topbar-item ${subItem.disabled ? 'disabled' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleItemClick(subItem);
                    }}
                  >
                    <div className="topbar-item-left">
                      {subItem.checked && <span className="topbar-check">&#10003;</span>}
                      <span>{subItem.label}</span>
                    </div>
                    {subItem.shortcut && (
                      <span className="topbar-shortcut">{subItem.shortcut}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // Regular item
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
  };

  return (
    <div ref={menuRef} className="topbar">
      <div className="topbar-brand">ArchDisc</div>

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

          {openMenu === key && (
            <div className="topbar-dropdown">
              {menu.items.map((item, index) => renderMenuItem(item, index, key))}
            </div>
          )}
        </div>
      ))}

      <div className="topbar-spacer" />

      <div className="topbar-status">
        <div className="topbar-status-dot" />
        <span>Ready</span>
      </div>
    </div>
  );
}
