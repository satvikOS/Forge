import { useState } from 'react';
import PropTypes from 'prop-types';
import ModelBrowser from './ModelBrowser';
import SketchfabViewer from './SketchfabViewer';
import '../styles/ModelPicker.css';

/**
 * ModelPicker Component
 * Modal for selecting Sketchfab models to attach to discoveries
 */
const ModelPicker = ({ isOpen, onClose, onSelect, allowMultiple = false }) => {
  const [selectedModels, setSelectedModels] = useState([]);
  const [previewModel, setPreviewModel] = useState(null);

  if (!isOpen) return null;

  const handleModelClick = (model) => {
    if (allowMultiple) {
      setSelectedModels(prev => {
        const isSelected = prev.some(m => m.uid === model.uid);
        if (isSelected) {
          return prev.filter(m => m.uid !== model.uid);
        } else {
          return [...prev, model];
        }
      });
    } else {
      setSelectedModels([model]);
    }
    setPreviewModel(model);
  };

  const handleConfirm = () => {
    if (selectedModels.length > 0) {
      onSelect(allowMultiple ? selectedModels : selectedModels[0]);
      handleClose();
    }
  };

  const handleClose = () => {
    setSelectedModels([]);
    setPreviewModel(null);
    onClose();
  };

  return (
    <div className="model-picker-overlay" onClick={handleClose}>
      <div className="model-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-picker-header">
          <h2>Select 3D Model{allowMultiple ? 's' : ''}</h2>
          <button className="close-button" onClick={handleClose}>
            ×
          </button>
        </div>

        <div className="model-picker-content">
          <div className="browser-section">
            <ModelBrowser
              onModelSelect={handleModelClick}
              selectedModels={selectedModels}
            />
          </div>

          {previewModel && (
            <div className="preview-section">
              <h3>Preview</h3>
              <div className="preview-viewer">
                <SketchfabViewer
                  modelUid={previewModel.uid}
                  width="100%"
                  height="300px"
                  autostart={1}
                  ui_infos={0}
                />
              </div>
              <div className="preview-info">
                <h4>{previewModel.name}</h4>
                <p className="preview-author">
                  by {previewModel.user?.displayName || previewModel.user?.username}
                </p>
                {previewModel.description && (
                  <p className="preview-description">
                    {previewModel.description.substring(0, 150)}
                    {previewModel.description.length > 150 ? '...' : ''}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="model-picker-footer">
          <div className="selection-info">
            {selectedModels.length > 0 ? (
              <span>
                {selectedModels.length} model{selectedModels.length > 1 ? 's' : ''} selected
              </span>
            ) : (
              <span>No models selected</span>
            )}
          </div>
          <div className="footer-actions">
            <button className="cancel-button" onClick={handleClose}>
              Cancel
            </button>
            <button
              className="confirm-button"
              onClick={handleConfirm}
              disabled={selectedModels.length === 0}
            >
              Add to Discovery
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

ModelPicker.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  allowMultiple: PropTypes.bool,
};

export default ModelPicker;
