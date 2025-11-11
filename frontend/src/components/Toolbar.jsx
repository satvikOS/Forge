import { useState } from 'react';

export default function Toolbar({ viewMode, onViewModeChange, isExploded, onExplodeToggle }) {
  const [showAssetsDropdown, setShowAssetsDropdown] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState(null);
  
  const tools = [
    { id: 'solid', label: 'Solid', icon: '◼' },
    { id: 'wireframe', label: 'Wireframe', icon: '▢' },
  ];

  const assets3D = {
    'Basic Shapes': {
      items: ['Cube', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'Pyramid', 'Prism', 'Dodecahedron', 'Icosahedron', 'Tetrahedron']
    },
    'Architectural Elements': {
      subcategories: {
        'Walls & Partitions': ['Exterior Wall', 'Interior Wall', 'Curtain Wall', 'Glass Partition', 'Brick Wall', 'Concrete Wall', 'Retaining Wall'],
        'Openings': ['Standard Door', 'Double Door', 'Sliding Door', 'French Door', 'Window - Single Hung', 'Window - Double Hung', 'Bay Window', 'Skylight', 'Garage Door'],
        'Vertical Circulation': ['Straight Stairs', 'L-Shaped Stairs', 'U-Shaped Stairs', 'Spiral Stairs', 'Circular Stairs', 'Elevator', 'Escalator', 'Ladder'],
        'Structural': ['Column - Round', 'Column - Square', 'Beam - Steel', 'Beam - Wood', 'Truss', 'Joist', 'Rafter', 'Girder', 'Post'],
        'Roofing': ['Gable Roof', 'Hip Roof', 'Flat Roof', 'Shed Roof', 'Mansard Roof', 'Gambrel Roof', 'Dome', 'Roof Tile', 'Shingles']
      }
    },
    'Furniture': {
      subcategories: {
        'Seating': ['Office Chair', 'Dining Chair', 'Armchair', 'Sofa - 2 Seater', 'Sofa - 3 Seater', 'Sectional Sofa', 'Bench', 'Stool', 'Bar Stool', 'Recliner', 'Lounge Chair'],
        'Tables': ['Dining Table', 'Coffee Table', 'Side Table', 'Desk', 'Conference Table', 'Console Table', 'End Table', 'Kitchen Island'],
        'Storage': ['Wardrobe', 'Dresser', 'Cabinet', 'Bookshelf', 'Filing Cabinet', 'Storage Unit', 'Chest of Drawers', 'Shelving Unit', 'TV Stand'],
        'Bedroom': ['Single Bed', 'Double Bed', 'Queen Bed', 'King Bed', 'Bunk Bed', 'Nightstand', 'Headboard', 'Mattress']
      }
    },
    'Fixtures & Appliances': {
      subcategories: {
        'Lighting': ['Ceiling Light', 'Pendant Light', 'Chandelier', 'Wall Sconce', 'Floor Lamp', 'Table Lamp', 'Track Light', 'Recessed Light', 'LED Strip'],
        'Kitchen': ['Refrigerator', 'Stove', 'Oven', 'Dishwasher', 'Microwave', 'Range Hood', 'Kitchen Sink', 'Faucet'],
        'Bathroom': ['Toilet', 'Sink', 'Bathtub', 'Shower', 'Shower Head', 'Vanity', 'Mirror', 'Towel Rack', 'Bidet'],
        'HVAC': ['Air Conditioner', 'Heater', 'Ventilation Unit', 'Thermostat', 'Ceiling Fan', 'Radiator']
      }
    },
    'Outdoor & Landscaping': {
      subcategories: {
        'Vegetation': ['Oak Tree', 'Pine Tree', 'Palm Tree', 'Bush', 'Hedge', 'Grass', 'Flower Bed', 'Shrub', 'Ivy'],
        'Hardscape': ['Paved Path', 'Gravel Path', 'Stepping Stones', 'Patio', 'Deck', 'Pergola', 'Gazebo'],
        'Fencing': ['Wooden Fence', 'Chain Link Fence', 'Picket Fence', 'Stone Wall', 'Gate', 'Railing'],
        'Site Elements': ['Bench', 'Street Light', 'Bollard', 'Fountain', 'Pond', 'Pool', 'Fire Pit']
      }
    },
    'Building Systems': {
      items: ['HVAC Unit', 'Electrical Panel', 'Circuit Breaker', 'Water Heater', 'Furnace', 'Boiler', 'Pump', 'Generator', 'Solar Panel', 'Ductwork', 'Plumbing Pipes', 'Electrical Conduit']
    },
    'Structural Components': {
      items: ['Foundation Wall', 'Concrete Slab', 'Footing', 'Pile Foundation', 'Floor Joist', 'Ceiling Joist', 'Stud Wall Frame', 'Shear Wall', 'Load-Bearing Wall', 'Steel Frame']
    },
    'Decorative Items': {
      items: ['Painting', 'Sculpture', 'Vase', 'Plant Pot', 'Rug', 'Curtain', 'Pillow', 'Wall Art', 'Ornament', 'Clock', 'Mirror Frame']
    },
    'Vehicles': {
      items: ['Sedan', 'SUV', 'Truck', 'Van', 'Motorcycle', 'Bicycle', 'Scooter', 'Bus', 'Sports Car']
    },
    'People & Scale': {
      items: ['Standing Person', 'Sitting Person', 'Walking Person', 'Person at Desk', 'Person Group', 'Child', 'Wheelchair User']
    }
  };

  return (
    <div style={{
      display: 'flex',
      gap: '10px',
      padding: '10px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)',
      alignItems: 'center',
    }}>
      {/* View mode selector */}
      <div style={{
        display: 'flex',
        gap: '5px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        padding: '4px',
      }}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onViewModeChange(tool.id)}
            style={{
              padding: '8px 16px',
              background: viewMode === tool.id ? 'var(--accent-orange)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: viewMode === tool.id ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: viewMode === tool.id ? 'bold' : 'normal',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (viewMode !== tool.id) {
                e.target.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (viewMode !== tool.id) {
                e.target.style.background = 'transparent';
              }
            }}
          >
            <span>{tool.icon}</span>
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      {/* Separator */}
      <div style={{
        width: '1px',
        height: '30px',
        background: 'var(--border-color)',
      }} />

      {/* Explode view toggle */}
      <button
        onClick={onExplodeToggle}
        style={{
          padding: '8px 16px',
          background: isExploded ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          color: isExploded ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: isExploded ? 'bold' : 'normal',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isExploded) {
            e.target.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isExploded) {
            e.target.style.background = 'var(--bg-tertiary)';
          }
        }}
      >
        <span>Explode View</span>
      </button>

      {/* Separator */}
      <div style={{
        width: '1px',
        height: '30px',
        background: 'var(--border-color)',
      }} />

      {/* 3D Assets Dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowAssetsDropdown(!showAssetsDropdown)}
          style={{
            padding: '8px 16px',
            background: showAssetsDropdown ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            color: showAssetsDropdown ? 'white' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: showAssetsDropdown ? 'bold' : 'normal',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!showAssetsDropdown) {
              e.target.style.background = 'var(--bg-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (!showAssetsDropdown) {
              e.target.style.background = 'var(--bg-tertiary)';
            }
          }}
        >
          <span>3D Assets</span>
          <span style={{ fontSize: '10px' }}>{showAssetsDropdown ? '▲' : '▼'}</span>
        </button>

        {/* Dropdown Menu */}
        {showAssetsDropdown && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '5px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '10px',
            minWidth: '350px',
            maxHeight: '500px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '10px',
              paddingBottom: '8px',
              borderBottom: '1px solid var(--border-color)',
            }}>
              Select an asset to add to your design
            </div>
            
            {Object.entries(assets3D).map(([category, data]) => (
              <div key={category} style={{ marginBottom: '8px' }}>
                <button
                  onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: expandedCategory === category ? 'var(--bg-hover)' : 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (expandedCategory !== category) {
                      e.currentTarget.style.background = 'var(--bg-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (expandedCategory !== category) {
                      e.currentTarget.style.background = 'var(--bg-tertiary)';
                    }
                  }}
                >
                  <span>{category}</span>
                  <span style={{ fontSize: '10px' }}>
                    {expandedCategory === category ? '▲' : '▼'}
                  </span>
                </button>

                {/* Category content */}
                {expandedCategory === category && (
                  <div style={{
                    marginTop: '5px',
                    marginLeft: '10px',
                    padding: '8px',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                  }}>
                    {data.subcategories ? (
                      // Has subcategories
                      Object.entries(data.subcategories).map(([subcat, items]) => (
                        <div key={subcat} style={{ marginBottom: '12px' }}>
                          <div style={{
                            fontSize: '11px',
                            color: 'var(--accent-orange)',
                            fontWeight: 'bold',
                            marginBottom: '6px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>
                            {subcat}
                          </div>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                            gap: '4px',
                          }}>
                            {items.map((item) => (
                              <button
                                key={item}
                                onClick={() => {
                                  console.log('Selected asset:', category, subcat, item);
                                  // TODO: Add asset to scene
                                }}
                                style={{
                                  padding: '6px 10px',
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '4px',
                                  color: 'var(--text-secondary)',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  textAlign: 'left',
                                  transition: 'all 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--accent-orange)';
                                  e.currentTarget.style.color = 'white';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'var(--bg-secondary)';
                                  e.currentTarget.style.color = 'var(--text-secondary)';
                                }}
                              >
                                {item}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      // Direct items
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: '4px',
                      }}>
                        {data.items.map((item) => (
                          <button
                            key={item}
                            onClick={() => {
                              console.log('Selected asset:', category, item);
                              // TODO: Add asset to scene
                            }}
                            style={{
                              padding: '6px 10px',
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              fontSize: '11px',
                              textAlign: 'left',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--accent-orange)';
                              e.currentTarget.style.color = 'white';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'var(--bg-secondary)';
                              e.currentTarget.style.color = 'var(--text-secondary)';
                            }}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Separator */}
      <div style={{
        width: '1px',
        height: '30px',
        background: 'var(--border-color)',
      }} />

      {/* Render button (placeholder) */}
      <button
        disabled
        style={{
          padding: '8px 16px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          color: 'var(--text-disabled)',
          cursor: 'not-allowed',
          fontSize: '14px',
          opacity: 0.5,
        }}
      >
        <span>Render (Coming Soon)</span>
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Help text */}
      <div style={{
        fontSize: '12px',
        color: 'var(--text-secondary)',
        fontStyle: 'italic',
      }}>
        Click on parts to select and edit them individually
      </div>
    </div>
  );
}
