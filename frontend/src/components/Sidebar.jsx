import { useState } from 'react';
import PropertiesPanel from './PropertiesPanel';

export default function Sidebar({ design, analysis, compliance }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          right: isOpen ? '350px' : '0',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRight: isOpen ? '1px solid var(--border-color)' : 'none',
          borderTopLeftRadius: '8px',
          borderBottomLeftRadius: '8px',
          padding: '12px 8px',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: '16px',
          zIndex: 101,
          transition: 'right 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '80px',
          boxShadow: isOpen ? 'none' : '-2px 0 8px rgba(0, 0, 0, 0.3)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-secondary)';
        }}
      >
        {isOpen ? '›' : '‹'}
      </button>

      {/* Sidebar Panel */}
      <div
        style={{
          position: 'fixed',
          right: isOpen ? '0' : '-350px',
          top: '36px',
          bottom: '0',
          width: '350px',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          transition: 'right 0.3s ease',
          zIndex: 100,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Sidebar Header */}
        <div
          style={{
            padding: '15px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 'bold',
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Properties
          </h3>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '20px',
              padding: '0',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            ×
          </button>
        </div>

        {/* Properties Content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <PropertiesPanel design={design} analysis={analysis} compliance={compliance} />
        </div>
      </div>
    </>
  );
}
