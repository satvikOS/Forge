import { useState, useEffect, useRef } from 'react';
import { contextMenus, menuConfig } from '../config/menuConfig';

export default function ContextMenu({ visible, position, currentMode, onClose, onAction }) {
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [visible, onClose]);

  if (!visible) return null;

  const menuItems = contextMenus[currentMode] || contextMenus.object;

  const handleItemClick = (itemId) => {
    onClose();
    setActiveSubmenu(null);
    if (onAction) {
      onAction(itemId);
    }
  };

  const getSubmenuItems = (itemId) => {
    if (itemId === 'add') {
      return menuConfig.add.items[0].submenu; // Primitives
    }
    return [];
  };

  const renderMenuItem = (item, index) => {
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

    const hasSubmenu = item.hasSubmenu;
    const isSubmenuOpen = activeSubmenu === item.id;

    return (
      <div
        key={item.id}
        style={{ position: 'relative' }}
        onMouseEnter={() => hasSubmenu && setActiveSubmenu(item.id)}
        onMouseLeave={() => !hasSubmenu && setActiveSubmenu(null)}
      >
        <button
          onClick={() => hasSubmenu ? null : handleItemClick(item.id)}
          style={{
            width: '100%',
            padding: '6px 12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: '12px',
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {item.icon && <span>{item.icon}</span>}
            <span>{item.label}</span>
          </div>
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
              minWidth: '160px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
              zIndex: 1003,
              marginLeft: '2px',
            }}
          >
            {getSubmenuItems(item.id).map((subItem) => (
              <button
                key={subItem.id}
                onClick={() => handleItemClick(subItem.id)}
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {subItem.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        minWidth: '180px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        zIndex: 1002,
        padding: '4px 0',
      }}
    >
      {menuItems.map(renderMenuItem)}
    </div>
  );
}
