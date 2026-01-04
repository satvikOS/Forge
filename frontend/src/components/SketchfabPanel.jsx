import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import ModelPicker from './ModelPicker';
import SketchfabViewer from './SketchfabViewer';
import sketchfabApi from '../services/sketchfabApi';
import '../styles/SketchfabPanel.css';

/**
 * SketchfabPanel Component
 * Panel for managing Sketchfab models in discoveries
 */
const SketchfabPanel = ({ models = [], onModelsChange }) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [expandedModel, setExpandedModel] = useState(null);
  const [sketchfabEnabled, setSketchfabEnabled] = useState(false);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await sketchfabApi.checkStatus();
        setSketchfabEnabled(status.enabled);
      } catch (err) {
        console.error('Error checking Sketchfab status:', err);
        setSketchfabEnabled(false);
      }
    };
    checkStatus();
  }, []);

  const handleAddModels = (newModels) => {
    const modelsArray = Array.isArray(newModels) ? newModels : [newModels];
    const updatedModels = [...models, ...modelsArray];
    onModelsChange(updatedModels);
  };

  const handleRemoveModel = (modelUid) => {
    const updatedModels = models.filter(m => m.uid !== modelUid);
    onModelsChange(updatedModels);
  };

  const toggleExpand = (modelUid) => {
    setExpandedModel(expandedModel === modelUid ? null : modelUid);
  };

  if (!sketchfabEnabled) {
    return (
      <div className="sketchfab-panel disabled">
        <div className="panel-header">
          <h3>🎨 3D Models (Sketchfab)</h3>
        </div>
        <div className="disabled-notice">
          <p>Sketchfab integration is not enabled.</p>
          <p className="small">Contact your administrator to enable this feature.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sketchfab-panel">
      <div className="panel-header">
        <h3>🎨 3D Models</h3>
        <button
          className="add-model-button"
          onClick={() => setIsPickerOpen(true)}
          title="Add 3D model from Sketchfab"
        >
          + Add Model
        </button>
      </div>

      {models.length === 0 ? (
        <div className="empty-models">
          <p>No 3D models attached</p>
          <button
            className="browse-button"
            onClick={() => setIsPickerOpen(true)}
          >
            Browse Sketchfab
          </button>
        </div>
      ) : (
        <div className="models-list">
          {models.map((model) => (
            <div key={model.uid} className="model-item">
              <div className="model-item-header">
                <div className="model-thumbnail">
                  {model.thumbnails?.images?.[0]?.url && (
                    <img
                      src={model.thumbnails.images[0].url}
                      alt={model.name}
                    />
                  )}
                </div>
                <div className="model-info">
                  <h4 className="model-title">{model.name}</h4>
                  <p className="model-author">
                    by {model.user?.displayName || model.user?.username}
                  </p>
                </div>
                <div className="model-actions">
                  <button
                    className="expand-button"
                    onClick={() => toggleExpand(model.uid)}
                    title={expandedModel === model.uid ? 'Collapse' : 'Expand'}
                  >
                    {expandedModel === model.uid ? '−' : '+'}
                  </button>
                  <button
                    className="remove-button"
                    onClick={() => handleRemoveModel(model.uid)}
                    title="Remove model"
                  >
                    ×
                  </button>
                </div>
              </div>

              {expandedModel === model.uid && (
                <div className="model-viewer-container">
                  <SketchfabViewer
                    modelUid={model.uid}
                    width="100%"
                    height="250px"
                    autostart={1}
                    ui_infos={0}
                    ui_stop={0}
                  />
                  <div className="model-details">
                    <div className="detail-row">
                      <span className="label">Views:</span>
                      <span className="value">{model.viewCount || 0}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Likes:</span>
                      <span className="value">{model.likeCount || 0}</span>
                    </div>
                    {model.isDownloadable && (
                      <div className="detail-row">
                        <span className="badge">📥 Downloadable</span>
                      </div>
                    )}
                    <a
                      href={`https://sketchfab.com/3d-models/${model.uid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="view-on-sketchfab"
                    >
                      View on Sketchfab →
                    </a>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ModelPicker
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={handleAddModels}
        allowMultiple={true}
      />
    </div>
  );
};

SketchfabPanel.propTypes = {
  models: PropTypes.arrayOf(
    PropTypes.shape({
      uid: PropTypes.string.isRequired,
      name: PropTypes.string,
      thumbnails: PropTypes.object,
      user: PropTypes.object,
      viewCount: PropTypes.number,
      likeCount: PropTypes.number,
      isDownloadable: PropTypes.bool,
    })
  ),
  onModelsChange: PropTypes.func.isRequired,
};

export default SketchfabPanel;
