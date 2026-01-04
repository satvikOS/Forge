/**
 * Materials Browser Component
 * Browse and search AmbientCG materials from the API
 */

import { useState, useEffect } from 'react';
import api from '../services/api';

export default function MaterialsBrowser({ isOpen, onClose, onSelectMaterial }) {
  const [materials, setMaterials] = useState([]);
  const [stats, setStats] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Load initial data
  useEffect(() => {
    if (isOpen) {
      loadMaterialData();
    }
  }, [isOpen]);

  const loadMaterialData = async () => {
    setLoading(true);
    try {
      // Load stats, types, and initial materials in parallel
      const [statsData, typesData, materialsData] = await Promise.all([
        api.getMaterialStats(),
        api.getMaterialTypes(),
        api.searchMaterials('', { limit: 50 })
      ]);

      setStats(statsData.stats);
      setTypes(typesData.types);
      setMaterials(materialsData.materials);
    } catch (error) {
      console.error('Error loading material data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    try {
      const filters = {};
      if (selectedType) filters.type = selectedType;

      const result = await api.searchMaterials(searchQuery, filters);
      setMaterials(result.materials);
    } catch (error) {
      console.error('Error searching materials:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await api.refreshMaterials();
      if (result.success) {
        // Reload data after refresh
        await loadMaterialData();
        alert(`Successfully refreshed ${result.count} materials from AmbientCG API!`);
      }
    } catch (error) {
      console.error('Error refreshing materials:', error);
      alert('Failed to refresh materials. Using cached data.');
    } finally {
      setRefreshing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      zIndex: 10000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a1a',
        borderRadius: '12px',
        width: '90%',
        maxWidth: '1200px',
        height: '80%',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: '24px' }}>
              Materials Browser
            </h2>
            {stats && (
              <p style={{ 
                margin: '5px 0 0 0', 
                color: 'rgba(255, 255, 255, 0.6)', 
                fontSize: '14px' 
              }}>
                {stats.totalMaterials} materials from {stats.source}
                {stats.lastApiSync && ` (synced ${new Date(stats.lastApiSync).toLocaleDateString()})`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: '24px',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Search Bar */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
        }}>
          <input
            type="text"
            placeholder="Search materials..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            style={{
              flex: 1,
              padding: '10px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '14px',
            }}
          />
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={{
              padding: '10px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '14px',
            }}
          >
            <option value="">All Types</option>
            {types.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{
              padding: '10px 20px',
              background: 'var(--accent-orange)',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: '10px 20px',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '6px',
              color: '#fff',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              fontSize: '14px',
            }}
          >
            {refreshing ? '🔄 Refreshing...' : '🔄 Refresh API'}
          </button>
        </div>

        {/* Materials Grid */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '15px',
          }}>
            {materials.map(material => (
              <div
                key={material.id}
                onClick={() => onSelectMaterial && onSelectMaterial(material)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 107, 53, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(255, 107, 53, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                }}
              >
                {material.previewUrl && (
                  <img
                    src={material.previewUrl}
                    alt={material.name}
                    style={{
                      width: '100%',
                      height: '120px',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      marginBottom: '10px',
                    }}
                  />
                )}
                <div style={{ color: '#fff', fontSize: '14px', fontWeight: '600', marginBottom: '5px' }}>
                  {material.name}
                </div>
                <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px' }}>
                  {material.type}
                </div>
                {material.tags && material.tags.length > 0 && (
                  <div style={{ 
                    marginTop: '8px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                  }}>
                    {material.tags.slice(0, 3).map((tag, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          background: 'rgba(255, 255, 255, 0.1)',
                          borderRadius: '3px',
                          color: 'rgba(255, 255, 255, 0.7)',
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
          {materials.length === 0 && !loading && (
            <div style={{
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.5)',
              padding: '40px',
            }}>
              No materials found. Try a different search or refresh from API.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
