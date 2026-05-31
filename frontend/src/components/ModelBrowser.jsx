import { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import ModelCard from './ModelCard';
import sketchfabApi from '../services/sketchfabApi';
import '../styles/ModelBrowser.css';

/**
 * ModelBrowser Component
 * Gallery interface for browsing Sketchfab models
 */
const ModelBrowser = ({ onModelSelect, selectedModels = [] }) => {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('architecture');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState('relevance');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [sketchfabEnabled, setSketchfabEnabled] = useState(false);

  // Check if Sketchfab is enabled
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await sketchfabApi.checkStatus();
        setSketchfabEnabled(status.enabled);
        if (!status.enabled) {
          setError(status.message);
        }
      } catch (err) {
        console.error('Error checking Sketchfab status:', err);
        setSketchfabEnabled(false);
        setError('Failed to check Sketchfab status');
      }
    };
    checkStatus();
  }, []);

  // Load models
  const loadModels = useCallback(async (resetResults = true) => {
    if (!sketchfabEnabled) return;

    setLoading(true);
    setError(null);

    try {
      const result = await sketchfabApi.searchModels({
        query: searchQuery,
        category,
        sortBy,
        count: 24,
        cursor: resetResults ? null : nextCursor,
      });

      if (result.success) {
        setModels(prev => resetResults ? result.results : [...prev, ...result.results]);
        setNextCursor(result.next);
        setHasMore(!!result.next);
      }
    } catch (err) {
      console.error('Error loading models:', err);
      setError('Failed to load models. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [sketchfabEnabled, searchQuery, category, sortBy, nextCursor]);

  // Initial load
  useEffect(() => {
    if (sketchfabEnabled) {
      loadModels(true);
    }
  }, [sketchfabEnabled, searchQuery, category, sortBy]);

  const handleSearch = (e) => {
    e.preventDefault();
    loadModels(true);
  };

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      loadModels(false);
    }
  };

  const isModelSelected = (modelUid) => {
    return selectedModels.some(m => m.uid === modelUid);
  };

  if (!sketchfabEnabled) {
    return (
      <div className="model-browser-disabled">
        <div className="disabled-message">
          <span className="disabled-icon">🔒</span>
          <h3>Sketchfab Integration Disabled</h3>
          <p>{error || 'Sketchfab integration is not configured. Please contact your administrator.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="model-browser">
      <div className="model-browser-header">
        <div className="sketchfab-logo">
          <img 
            src="https://static.sketchfab.com/static/builds/web/dist/2.90.0/07ba5ee/img/components/header/logo_default.svg" 
            alt="Sketchfab" 
            height="24"
          />
        </div>
        
        <form className="search-form" onSubmit={handleSearch}>
          <div className="search-input-group">
            <input
              type="text"
              className="search-input"
              placeholder="Search for architectural models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" className="search-button" disabled={loading}>
              {loading ? '🔄' : '🔍'}
            </button>
          </div>
        </form>

        <div className="browser-controls">
          <select
            className="filter-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={loading}
          >
            <option value="">All Categories</option>
            <option value="architecture">Architecture</option>
            <option value="cultural-heritage-history">Cultural Heritage</option>
            <option value="places-travel">Places & Travel</option>
          </select>

          <select
            className="filter-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            disabled={loading}
          >
            <option value="relevance">Relevance</option>
            <option value="likes">Most Liked</option>
            <option value="views">Most Viewed</option>
            <option value="recent">Recently Added</option>
          </select>

          <div className="view-mode-toggle">
            <button
              className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              ⊞
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              ☰
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className={`models-container ${viewMode}`}>
        {models.map((model) => (
          <ModelCard
            key={model.uid}
            model={model}
            onClick={onModelSelect}
            selected={isModelSelected(model.uid)}
          />
        ))}
      </div>

      {loading && models.length === 0 && (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading models...</p>
        </div>
      )}

      {models.length === 0 && !loading && !error && (
        <div className="empty-state">
          <span className="empty-icon">🔍</span>
          <p>No models found. Try a different search query.</p>
        </div>
      )}

      {hasMore && models.length > 0 && (
        <div className="load-more-container">
          <button
            className="load-more-btn"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      <div className="model-browser-footer">
        <p className="powered-by">
          Powered by{' '}
          <a
            href="https://sketchfab.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Sketchfab
          </a>
        </p>
      </div>
    </div>
  );
};

ModelBrowser.propTypes = {
  onModelSelect: PropTypes.func.isRequired,
  selectedModels: PropTypes.arrayOf(
    PropTypes.shape({
      uid: PropTypes.string,
    })
  ),
};

export default ModelBrowser;
