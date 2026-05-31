/**
 * Asset Browser Component - UI for browsing and selecting environment assets
 */

import { useState, useMemo } from 'react';

export default function AssetBrowser({ assetManager, onAssetSelect }) {
  const [selectedCategory, setSelectedCategory] = useState('abiotic');
  const [selectedSubcategory, setSelectedSubcategory] = useState('landforms');
  const [searchQuery, setSearchQuery] = useState('');

  const categories = assetManager.getCategories();
  const subcategories = assetManager.getSubcategories(selectedCategory);

  // Get filtered assets
  const assets = useMemo(() => {
    let filtered = assetManager.getAssetsBySubcategory(selectedCategory, selectedSubcategory);
    
    if (searchQuery) {
      filtered = assetManager.searchAssets(searchQuery);
    }
    
    return filtered;
  }, [selectedCategory, selectedSubcategory, searchQuery, assetManager]);

  const handleAssetClick = (asset) => {
    if (onAssetSelect) {
      onAssetSelect(asset);
    }
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
    }}>
      {/* Search Bar */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <input
          type="text"
          placeholder="Search assets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            fontSize: '14px',
          }}
        />
      </div>

      {/* Category Tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        overflowX: 'auto',
      }}>
        {categories.map(category => (
          <button
            key={category.id}
            onClick={() => {
              setSelectedCategory(category.id);
              setSelectedSubcategory(category.subcategories[0]);
              setSearchQuery('');
            }}
            style={{
              padding: '6px 12px',
              background: selectedCategory === category.id ? 'var(--accent-color)' : 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: selectedCategory === category.id ? 'white' : 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '12px',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>{category.icon}</span>
            <span>{category.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {/* Subcategory Tabs */}
      {!searchQuery && (
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          flexWrap: 'wrap',
        }}>
          {subcategories.map(subcat => (
            <button
              key={subcat}
              onClick={() => setSelectedSubcategory(subcat)}
              style={{
                padding: '4px 10px',
                background: selectedSubcategory === subcat ? 'var(--accent-secondary)' : 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '11px',
                textTransform: 'capitalize',
              }}
            >
              {subcat}
            </button>
          ))}
        </div>
      )}

      {/* Asset Grid */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: '12px',
        }}>
          {assets.map(asset => (
            <div
              key={asset.id}
              onClick={() => handleAssetClick(asset)}
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                ':hover': {
                  borderColor: 'var(--accent-color)',
                  transform: 'translateY(-2px)',
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-color)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Asset Thumbnail/Icon */}
              <div style={{
                width: '80px',
                height: '80px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32px',
              }}>
                {getAssetIcon(asset)}
              </div>

              {/* Asset Name */}
              <div style={{
                fontSize: '11px',
                color: 'var(--text-primary)',
                textAlign: 'center',
                lineHeight: '1.3',
                fontWeight: '500',
              }}>
                {asset.name}
              </div>

              {/* Asset Tags */}
              {asset.metadata.tags.length > 0 && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '2px',
                  justifyContent: 'center',
                }}>
                  {asset.metadata.tags.slice(0, 2).map(tag => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '9px',
                        padding: '2px 4px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '2px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {assets.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            color: 'var(--text-secondary)',
            fontSize: '14px',
          }}>
            {searchQuery ? 'No assets found matching your search' : 'No assets in this category'}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to get icon for asset
function getAssetIcon(asset) {
  const iconMap = {
    'mountain': '⛰️',
    'hill': '🏔️',
    'valley': '🏞️',
    'canyon': '🏜️',
    'plain': '🌾',
    'plateau': '🗻',
    'desert': '🏜️',
    'beach': '🏖️',
    'cliff': '🪨',
    'boulder': '🪨',
    'rock': '🪨',
    'volcano': '🌋',
    'ocean': '🌊',
    'sea': '🌊',
    'river': '〰️',
    'lake': '💧',
    'pond': '💧',
    'stream': '〰️',
    'bay': '🏖️',
    'glacier': '🧊',
    'wetland': '🌾',
    'waterfall': '💦',
    'canal': '〰️',
    'reservoir': '💧',
    'sky': '🌤️',
    'cloud': '☁️',
    'cloud_layer': '☁️',
    'sun': '☀️',
    'moon': '🌙',
    'stars': '✨',
    'rain': '🌧️',
    'snow': '❄️',
    'fog': '🌫️',
    'rainbow': '🌈',
    'lightning': '⚡',
    'sunrise': '🌅',
    'aurora': '🌌',
    'tree_oak': '🌳',
    'tree_maple': '🌳',
    'tree_birch': '🌳',
    'tree_cherry': '🌸',
    'tree_pine': '🌲',
    'tree_spruce': '🌲',
    'tree_fir': '🌲',
    'tree_palm': '🌴',
    'shrub': '🌿',
    'grass': '🌱',
    'grass_instanced': '🌾',
    'flower_rose': '🌹',
    'flower_daisy': '🌼',
    'flower_tulip': '🌷',
    'moss': '🟢',
    'crop_corn': '🌽',
    'crop_wheat': '🌾',
    'crop_rice': '🌾',
    'mushroom': '🍄',
    'toadstool': '🍄',
    'building_house': '🏠',
    'building_apartment': '🏢',
    'building_hut': '🛖',
    'building_skyscraper': '🏙️',
    'building_shop': '🏪',
    'building_warehouse': '🏭',
    'building_factory': '🏭',
    'building_school': '🏫',
    'building_hospital': '🏥',
    'building_church': '⛪',
    'building_stadium': '🏟️',
    'road_highway': '🛣️',
    'road_street': '🛤️',
    'road_path_dirt': '🛤️',
    'road_path_gravel': '🛤️',
    'road_sidewalk': '🚶',
    'road_bridge': '🌉',
    'road_tunnel': '🚇',
    'road_parking': '🅿️',
    'road_roundabout': '⭕',
    'road_intersection': '➕',
  };

  return iconMap[asset.id] || '📦';
}
