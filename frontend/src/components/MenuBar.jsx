import { useState, useRef, useEffect } from 'react';
import { menuConfig } from '../config/menuConfig';

export default function MenuBar({ onMenuAction }) {
  const [openMenu, setOpenMenu] = useState(null);
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const menuBarRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuBarRef.current && !menuBarRef.current.contains(event.target)) {
        setOpenMenu(null);
        setOpenSubmenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (menuKey) => {
    setOpenMenu(openMenu === menuKey ? null : menuKey);
    setOpenSubmenu(null);
  };

  const handleItemClick = (itemId) => {
    setOpenMenu(null);
    setOpenSubmenu(null);
    if (onMenuAction) {
      onMenuAction(itemId);
    }
  };

  const handleItemHover = (itemId, hasSubmenu) => {
    if (hasSubmenu) {
      setOpenSubmenu(itemId);
    }
  };

  const renderMenuItems = (items, isSubmenu = false) => {
    return items.map((item, index) => {
      if (item.type === 'separator') {
        return (
          <div
            key={`sep-${index}`}
            style={{
              height: '1px',
              background: 'var(--border-color)',
              margin: '4px 0',
            }}
          />
        );
      }

      const hasSubmenu = item.submenu && item.submenu.length > 0;
      const isSubmenuOpen = openSubmenu === item.id;

      return (
        <div
          key={item.id}
          style={{ position: 'relative' }}
          onMouseEnter={() => handleItemHover(item.id, hasSubmenu)}
        >
          <button
            onClick={() => hasSubmenu ? null : handleItemClick(item.id)}
            style={{
              width: '100%',
              padding: '6px 12px',
              background: isSubmenuOpen ? 'var(--bg-hover)' : 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '12px',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              if (!isSubmenuOpen) {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSubmenuOpen) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span>{item.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {item.shortcut && (
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                  {item.shortcut}
                </span>
              )}
              {hasSubmenu && <span style={{ fontSize: '10px' }}>▸</span>}
            </div>
          </button>

          {hasSubmenu && isSubmenuOpen && (
            <div
              style={{
                position: 'absolute',
                left: '100%',
                top: 0,
                minWidth: '200px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                zIndex: 10003,
                marginLeft: '2px',
                maxHeight: '400px',
                overflowY: 'auto',
              }}
            >
              {renderMenuItems(item.submenu, true)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div
      ref={menuBarRef}
      style={{
        display: 'flex',
        gap: '1px',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        padding: '0 6px',
        userSelect: 'none',
      }}
    >
      {Object.entries(menuConfig).map(([key, menu]) => (
        <div key={key} style={{ position: 'relative' }}>
          <button
            onClick={() => handleMenuClick(key)}
            style={{
              padding: '4px 10px',
              background: openMenu === key ? 'var(--bg-hover)' : 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '11px',
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => {
              if (openMenu !== key) {
                e.currentTarget.style.background = 'var(--bg-tertiary)';
              }
            }}
            onMouseLeave={(e) => {
              if (openMenu !== key) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {menu.label}
          </button>

          {openMenu === key && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                minWidth: '200px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                zIndex: 10001,
                marginTop: '2px',
                maxHeight: '500px',
                overflowY: 'auto',
              }}
            >
              {renderMenuItems(menu.items)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
