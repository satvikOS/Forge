import { useState } from 'react';

export default function Topbar({ status = 'Ready', loading = false }) {
  const [activeMenu, setActiveMenu] = useState(null);

  const menus = {
    File: ['New Project', 'Open', 'Save', 'Save As', 'Export', 'Import'],
    Edit: ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete'],
    View: ['Wireframe', 'Solid', 'Grid', 'Axes', 'Reset Camera'],
    Tools: ['Measure', 'Analyze', 'Compliance Check', 'Settings'],
    '3D Assets': [
      { category: 'Primitives', items: ['Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'Plane'] },
      { category: 'Architecture', items: ['Wall', 'Door', 'Window', 'Stairs', 'Column', 'Beam'] },
      { category: 'Furniture', items: ['Chair', 'Table', 'Desk', 'Sofa', 'Bed', 'Cabinet'] },
      { category: 'Vehicles', items: ['Car', 'Truck', 'Bike', 'Motorcycle'] },
      { category: 'Electronics', items: ['Smartphone', 'Laptop', 'Monitor', 'Speaker'] },
      { category: 'Nature', items: ['Tree', 'Bush', 'Rock', 'Grass'] },
    ],
    Help: ['Documentation', 'Tutorials', 'About'],
  };

  const handleMenuClick = (menuName) => {
    setActiveMenu(activeMenu === menuName ? null : menuName);
  };

  const handleMenuItemClick = (item) => {
    console.log('Menu item clicked:', item);
    setActiveMenu(null);
    // Add actual functionality here
  };

  return (
    <div style={{
      height: '36px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      position: 'relative',
      zIndex: 1000,
    }}>
      {/* Left - Menu Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
        {Object.keys(menus).map((menuName) => (
          <div key={menuName} style={{ position: 'relative' }}>
            <button
              onClick={() => handleMenuClick(menuName)}
              style={{
                background: activeMenu === menuName ? 'var(--bg-tertiary)' : 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                padding: '6px 12px',
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '4px',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (activeMenu === menuName) return;
                e.target.style.background = 'var(--bg-tertiary)';
              }}
              onMouseLeave={(e) => {
                if (activeMenu === menuName) return;
                e.target.style.background = 'transparent';
              }}
            >
              {menuName}
            </button>

            {/* Dropdown Menu */}
            {activeMenu === menuName && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '0',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                minWidth: '200px',
                maxHeight: '400px',
                overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                marginTop: '4px',
                zIndex: 1001,
              }}>
                {menuName === '3D Assets' ? (
                  // Special rendering for 3D Assets with categories
                  <>
                    {menus[menuName].map((category, idx) => (
                      <div key={idx}>
                        <div style={{
                          padding: '8px 12px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          color: 'var(--accent-orange)',
                          textTransform: 'uppercase',
                          borderTop: idx > 0 ? '1px solid var(--border-color)' : 'none',
                          marginTop: idx > 0 ? '4px' : '0',
                          paddingTop: idx > 0 ? '8px' : '8px',
                        }}>
                          {category.category}
                        </div>
                        {category.items.map((item) => (
                          <button
                            key={item}
                            onClick={() => handleMenuItemClick(item)}
                            style={{
                              width: '100%',
                              padding: '8px 12px 8px 24px',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                              textAlign: 'left',
                              cursor: 'pointer',
                              transition: 'background 0.2s',
                            }}
                            onMouseEnter={(e) => e.target.style.background = 'var(--bg-tertiary)'}
                            onMouseLeave={(e) => e.target.style.background = 'transparent'}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    ))}
                    <div style={{
                      borderTop: '1px solid var(--border-color)',
                      marginTop: '4px',
                      paddingTop: '4px',
                    }}>
                      <button
                        onClick={() => handleMenuItemClick('Browse Library')}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--accent-orange)',
                          fontSize: '13px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => e.target.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={(e) => e.target.style.background = 'transparent'}
                      >
                        Browse Library...
                      </button>
                      <button
                        onClick={() => handleMenuItemClick('Import Asset')}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => e.target.style.background = 'var(--bg-tertiary)'}
                        onMouseLeave={(e) => e.target.style.background = 'transparent'}
                      >
                        Import Asset...
                      </button>
                    </div>
                  </>
                ) : (
                  // Standard menu items
                  menus[menuName].map((item) => (
                    <button
                      key={item}
                      onClick={() => handleMenuItemClick(item)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => e.target.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      {item}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Right - Status Indicator */}
      <div style={{
        fontSize: '12px',
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        {loading && (
          <>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--accent-orange)',
            }} />
            Generating...
          </>
        )}
      </div>

      {/* Click outside to close menu */}
      {activeMenu && (
        <div
          onClick={() => setActiveMenu(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
        />
      )}
    </div>
  );
}
