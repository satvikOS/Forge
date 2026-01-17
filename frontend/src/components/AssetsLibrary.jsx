import { useState } from 'react';

const ASSETS_LIBRARY = {
  'Basic Shapes': [
    { id: 'cube', name: 'Cube', icon: '◼️' },
    { id: 'sphere', name: 'Sphere', icon: '⚪' },
    { id: 'cylinder', name: 'Cylinder', icon: '🔵' },
    { id: 'cone', name: 'Cone', icon: '🔺' },
    { id: 'torus', name: 'Torus', icon: '🍩' },
    { id: 'pyramid', name: 'Pyramid', icon: '🔻' },
    { id: 'plane', name: 'Plane', icon: '▭' },
  ],
  'Architectural Elements': [
    { id: 'wall', name: 'Wall', icon: '🧱' },
    { id: 'door', name: 'Door', icon: '🚪' },
    { id: 'window', name: 'Window', icon: '🪟' },
    { id: 'column', name: 'Column', icon: '🏛️' },
    { id: 'beam', name: 'Beam', icon: '━' },
    { id: 'stairs', name: 'Stairs', icon: '🪜' },
    { id: 'roof', name: 'Roof', icon: '🏠' },
    { id: 'floor', name: 'Floor', icon: '▬' },
  ],
  'Furniture': [
    { id: 'chair', name: 'Chair', icon: '🪑' },
    { id: 'table', name: 'Table', icon: '🗿' },
    { id: 'bed', name: 'Bed', icon: '🛏️' },
    { id: 'sofa', name: 'Sofa', icon: '🛋️' },
    { id: 'cabinet', name: 'Cabinet', icon: '🗄️' },
    { id: 'shelf', name: 'Shelf', icon: '📚' },
    { id: 'desk', name: 'Desk', icon: '🖥️' },
  ],
  'Fixtures': [
    { id: 'light', name: 'Light', icon: '💡' },
    { id: 'sink', name: 'Sink', icon: '🚰' },
    { id: 'toilet', name: 'Toilet', icon: '🚽' },
    { id: 'bathtub', name: 'Bathtub', icon: '🛁' },
    { id: 'shower', name: 'Shower', icon: '🚿' },
    { id: 'appliance', name: 'Appliance', icon: '📺' },
  ],
  'Outdoor Elements': [
    { id: 'tree', name: 'Tree', icon: '🌳' },
    { id: 'plant', name: 'Plant', icon: '🪴' },
    { id: 'fence', name: 'Fence', icon: '🚧' },
    { id: 'pathway', name: 'Pathway', icon: '🛤️' },
    { id: 'bench', name: 'Bench', icon: '🪑' },
  ],
  'Structural Components': [
    { id: 'foundation', name: 'Foundation', icon: '⬜' },
    { id: 'slab', name: 'Slab', icon: '▭' },
    { id: 'truss', name: 'Truss', icon: '▲' },
    { id: 'joist', name: 'Joist', icon: '━' },
    { id: 'rebar', name: 'Rebar', icon: '🔩' },
  ],
  'Building Systems': [
    { id: 'hvac', name: 'HVAC Unit', icon: '❄️' },
    { id: 'electrical', name: 'Electrical Panel', icon: '⚡' },
    { id: 'plumbing', name: 'Plumbing', icon: '💧' },
    { id: 'duct', name: 'Duct', icon: '🌬️' },
  ],
  'Decorative Items': [
    { id: 'artwork', name: 'Artwork', icon: '🖼️' },
    { id: 'sculpture', name: 'Sculpture', icon: '🗿' },
    { id: 'ornament', name: 'Ornament', icon: '✨' },
    { id: 'vase', name: 'Vase', icon: '🏺' },
  ],
  'Vehicles': [
    { id: 'car', name: 'Car', icon: '🚗' },
    { id: 'bike', name: 'Bike', icon: '🚲' },
    { id: 'truck', name: 'Truck', icon: '🚚' },
  ],
  'People/Characters': [
    { id: 'person-standing', name: 'Person Standing', icon: '🧍' },
    { id: 'person-sitting', name: 'Person Sitting', icon: '🪑' },
    { id: 'person-walking', name: 'Person Walking', icon: '🚶' },
  ],
};

export default function AssetsLibrary({ onAssetSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);

  const handleAssetClick = (asset) => {
    onAssetSelect(asset);
    setIsOpen(false);
    setSelectedCategory(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Assets Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 16px',
          background: isOpen ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          color: isOpen ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: isOpen ? 'bold' : 'normal',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.target.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.target.style.background = 'var(--bg-tertiary)';
          }
        }}
      >
        <span>📦</span>
        <span>3D Assets</span>
        <span style={{ fontSize: '12px' }}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '45px',
          left: 0,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '10px',
          minWidth: '250px',
          maxHeight: '500px',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        }}>
          {selectedCategory ? (
            // Show assets in selected category
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '10px',
                paddingBottom: '10px',
                borderBottom: '1px solid var(--border-color)',
              }}>
                <button
                  onClick={() => setSelectedCategory(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-orange)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <span>←</span>
                  <span>Back</span>
                </button>
                <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 'bold' }}>
                  {selectedCategory}
                </span>
              </div>

              <div style={{ display: 'grid', gap: '5px' }}>
                {ASSETS_LIBRARY[selectedCategory].map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => handleAssetClick(asset)}
                    style={{
                      padding: '10px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      textAlign: 'left',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'var(--bg-hover)';
                      e.target.style.borderColor = 'var(--accent-orange)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'var(--bg-tertiary)';
                      e.target.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    <span style={{ fontSize: '12px' }}>{asset.icon}</span>
                    <span>{asset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Show categories
            <div>
              <div style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '10px',
                paddingBottom: '10px',
                borderBottom: '1px solid var(--border-color)',
              }}>
                Select a category:
              </div>

              <div style={{ display: 'grid', gap: '5px' }}>
                {Object.keys(ASSETS_LIBRARY).map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    style={{
                      padding: '10px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'var(--bg-hover)';
                      e.target.style.borderColor = 'var(--accent-orange)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'var(--bg-tertiary)';
                      e.target.style.borderColor = 'var(--border-color)';
                    }}
                  >
                    <span>{category}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      ({ASSETS_LIBRARY[category].length})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
