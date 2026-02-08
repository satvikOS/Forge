import { useState, useRef, useEffect, useCallback } from 'react';
import './Topbar.css';

/**
 * Topbar - Application menu bar with smart viewport-aware positioning
 * All dropdowns and submenus use fixed positioning to prevent overflow.
 * Renders as an inline nav element to embed within the workbench header.
 */
export default function Topbar() {
  const [openMenu, setOpenMenu] = useState(null);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const [submenuStyle, setSubmenuStyle] = useState({});
  const [activeSubmenuItems, setActiveSubmenuItems] = useState([]);
  const menuRef = useRef(null);
  const submenuTimerRef = useRef(null);
  const triggerRefs = useRef({});

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenu(null);
        setOpenSubmenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup timer
  useEffect(() => {
    return () => clearTimeout(submenuTimerRef.current);
  }, []);

  // ─── Menu Definitions ─────────────────────────────────────────────────────────
  // Application-level menus only. Tool creation (Insert, Sketch, etc.) lives in
  // the left sidebar to avoid duplication.
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
          { label: 'glTF / GLB', action: () => console.log('Import glTF') },
          { label: 'DXF / DWG', action: () => console.log('Import DXF') },
          { label: 'JT (.jt)', action: () => console.log('Import JT') },
          { label: 'CATIA V5 (.CATpart)', action: () => console.log('Import CATIA') },
          { label: 'NX (.prt)', action: () => console.log('Import NX') },
          { label: 'Creo / Pro-E (.prt)', action: () => console.log('Import Creo') },
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
          { label: 'glTF / GLB', action: () => console.log('Export glTF') },
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
        { label: 'Zoom to Fit', shortcut: 'Home', action: () => console.log('Zoom Fit') },
        { label: 'Zoom to Selection', shortcut: 'F', action: () => console.log('Zoom Selection') },
        { type: 'separator' },
        { label: 'Section View', action: () => console.log('Section View') },
        { label: 'Perspective', action: () => console.log('Perspective'), checked: true },
        { type: 'separator' },
        { label: 'Show / Hide', submenu: [
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
        { label: 'Appearance', action: () => console.log('Appearance') },
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

  // ─── Smart Positioning ─────────────────────────────────────────────────────────

  const calcDropdownPos = useCallback((triggerEl) => {
    if (!triggerEl) return {};
    const rect = triggerEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dropW = 260;

    const style = { position: 'fixed', zIndex: 1000 };

    // Horizontal: align left with trigger, clamp to viewport
    style.left = Math.min(rect.left, vw - dropW - 8);

    // Vertical: directly below trigger
    style.top = rect.bottom;

    // Limit height so it doesn't go off screen
    const maxH = vh - rect.bottom - 8;
    if (maxH < 200) {
      // If too little space below, show above
      style.top = 'auto';
      style.bottom = vh - rect.top;
      style.maxHeight = rect.top - 8;
    } else {
      style.maxHeight = maxH;
    }

    return style;
  }, []);

  const calcSubmenuPos = useCallback((parentItemEl) => {
    if (!parentItemEl) return {};
    const rect = parentItemEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const subW = 240;

    // Find the dropdown panel that contains this item
    const dropPanel = parentItemEl.closest('.topbar-dropdown');
    const dropRect = dropPanel ? dropPanel.getBoundingClientRect() : rect;

    const style = { position: 'fixed', zIndex: 1001 };

    // Horizontal: prefer right of dropdown, fall back to left
    if (dropRect.right + subW + 4 < vw) {
      style.left = dropRect.right + 2;
    } else if (dropRect.left - subW - 2 > 0) {
      style.left = dropRect.left - subW - 2;
    } else {
      style.left = Math.max(4, vw - subW - 4);
    }

    // Vertical: align with parent item, clamp to viewport
    const estimateH = 300;
    if (rect.top + estimateH < vh) {
      style.top = rect.top - 4;
    } else {
      style.top = Math.max(4, vh - estimateH - 4);
    }

    return style;
  }, []);

  // ─── Event Handlers ────────────────────────────────────────────────────────────

  const handleMenuClick = (menuKey) => {
    if (openMenu === menuKey) {
      setOpenMenu(null);
      setOpenSubmenu(null);
    } else {
      setOpenMenu(menuKey);
      setOpenSubmenu(null);
      setDropdownStyle(calcDropdownPos(triggerRefs.current[menuKey]));
    }
  };

  const handleMenuHover = (menuKey) => {
    if (openMenu && openMenu !== menuKey) {
      setOpenMenu(menuKey);
      setOpenSubmenu(null);
      setDropdownStyle(calcDropdownPos(triggerRefs.current[menuKey]));
    }
  };

  const handleItemClick = (item) => {
    if (!item.disabled && item.action) {
      item.action();
      setOpenMenu(null);
      setOpenSubmenu(null);
    }
  };

  const handleSubmenuEnter = (key, items, e) => {
    clearTimeout(submenuTimerRef.current);
    setOpenSubmenu(key);
    setActiveSubmenuItems(items);
    setSubmenuStyle(calcSubmenuPos(e.currentTarget));
  };

  const handleSubmenuLeave = () => {
    submenuTimerRef.current = setTimeout(() => {
      setOpenSubmenu(null);
    }, 120);
  };

  const handleSubmenuPanelEnter = () => {
    clearTimeout(submenuTimerRef.current);
  };

  const handleSubmenuPanelLeave = () => {
    setOpenSubmenu(null);
  };

  // ─── Renderers ─────────────────────────────────────────────────────────────────

  const renderMenuItem = (item, index, parentKey) => {
    if (item.type === 'separator') {
      return <div key={index} className="topbar-separator" />;
    }

    // Item with submenu → arrow indicator, hover to open
    if (item.submenu) {
      const subKey = `${parentKey}-${index}`;
      return (
        <div
          key={index}
          className={`topbar-item has-submenu ${openSubmenu === subKey ? 'submenu-active' : ''}`}
          onMouseEnter={(e) => handleSubmenuEnter(subKey, item.submenu, e)}
          onMouseLeave={handleSubmenuLeave}
        >
          <div className="topbar-item-left">
            <span>{item.label}</span>
          </div>
          <span className="topbar-submenu-arrow">&#9656;</span>
        </div>
      );
    }

    // Regular item
    return (
      <div
        key={index}
        className={`topbar-item ${item.disabled ? 'disabled' : ''}`}
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

  // ─── Render ────────────────────────────────────────────────────────────────────

  return (
    <nav ref={menuRef} className="topbar-menus">
      {/* Menu triggers */}
      {Object.entries(menus).map(([key, menu]) => (
        <button
          key={key}
          ref={(el) => (triggerRefs.current[key] = el)}
          className={`topbar-menu-trigger ${openMenu === key ? 'active' : ''}`}
          onClick={() => handleMenuClick(key)}
          onMouseEnter={() => handleMenuHover(key)}
        >
          {menu.label}
        </button>
      ))}

      {/* Dropdown panel - fixed positioned overlay */}
      {openMenu && menus[openMenu] && (
        <div className="topbar-dropdown" style={dropdownStyle}>
          {menus[openMenu].items.map((item, i) => renderMenuItem(item, i, openMenu))}
        </div>
      )}

      {/* Submenu panel - fixed positioned overlay */}
      {openSubmenu && activeSubmenuItems.length > 0 && (
        <div
          className="topbar-submenu"
          style={submenuStyle}
          onMouseEnter={handleSubmenuPanelEnter}
          onMouseLeave={handleSubmenuPanelLeave}
        >
          {activeSubmenuItems.map((subItem, si) => {
            if (subItem.type === 'separator') {
              return <div key={si} className="topbar-separator" />;
            }
            return (
              <div
                key={si}
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
    </nav>
  );
}
