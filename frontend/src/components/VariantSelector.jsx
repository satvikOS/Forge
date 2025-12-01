import PropTypes from 'prop-types';
import './VariantSelector.css';

/**
 * VariantSelector Component
 * Displays 3 ultra-realistic design variants in a professional grid layout
 * Allows users to select between different design options and create the design
 */
function VariantSelector({ variants, selectedVariant, onVariantSelect, onCreateDesign, isCreating }) {
  if (!variants || variants.length === 0) {
    return null;
  }

  const getStyleBadgeColor = (style) => {
    switch (style) {
      case 'photorealistic':
        return '#4CAF50';
      case 'engineering-detail':
        return '#2196F3';
      case 'artistic-quality':
        return '#FF9800';
      case 'ethereal-fantasy':
        return '#9C27B0';
      case 'biomechanical-complex':
        return '#FF5722';
      case 'cosmic-surreal':
        return '#00BCD4';
      default:
        return '#757575';
    }
  };

  const formatDimensions = (dimensions) => {
    if (!dimensions) return 'N/A';
    const { width, height, depth } = dimensions;
    return `${width?.toFixed(1) || 0}m × ${height?.toFixed(1) || 0}m × ${depth?.toFixed(1) || 0}m`;
  };

  const formatMaterials = (materials) => {
    if (!materials || materials.length === 0) return 'Standard materials';
    return materials.slice(0, 3).join(', ') + (materials.length > 3 ? '...' : '');
  };

  const selectedVariantData = variants[selectedVariant];

  return (
    <div className="variant-selector">
      <div className="variant-selector-header">
        <h3>🎨 Design Variants</h3>
        <p>Select your preferred design option, then click Create Design</p>
      </div>
      
      <div className="variant-grid">
        {variants.map((variant, index) => {
          const isSelected = selectedVariant === index;
          const badgeColor = getStyleBadgeColor(variant.style);
          
          return (
            <div
              key={index}
              className={`variant-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onVariantSelect(index)}
              role="button"
              tabIndex={0}
              onKeyPress={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onVariantSelect(index);
                }
              }}
            >
              {/* Style Badge */}
              <div className="variant-badge" style={{ backgroundColor: badgeColor }}>
                {variant.title}
              </div>
              
              {/* Selection Indicator */}
              {isSelected && (
                <div className="variant-selected-indicator">
                  <span className="checkmark">✓</span>
                </div>
              )}
              
              {/* Variant Content */}
              <div className="variant-content">
                <h4 className="variant-name">{variant.name}</h4>
                <p className="variant-description">{variant.description}</p>
                
                {/* Metadata */}
                <div className="variant-metadata">
                  <div className="metadata-item">
                    <span className="metadata-icon">📏</span>
                    <span className="metadata-label">Dimensions</span>
                    <span className="metadata-value">{formatDimensions(variant.dimensions)}</span>
                  </div>
                  
                  <div className="metadata-item">
                    <span className="metadata-icon">🏗️</span>
                    <span className="metadata-label">Materials</span>
                    <span className="metadata-value">{formatMaterials(variant.materials)}</span>
                  </div>
                  
                  {variant.metadata?.complexity && (
                    <div className="metadata-item">
                      <span className="metadata-icon">⚙️</span>
                      <span className="metadata-label">Complexity</span>
                      <span className="metadata-value">{variant.metadata.complexity}</span>
                    </div>
                  )}
                </div>
                
                {/* Details Preview */}
                {variant.details && (
                  <div className="variant-details">
                    {variant.details.structuralFeatures && variant.details.structuralFeatures.length > 0 && (
                      <div className="detail-section">
                        <strong>Features:</strong> {variant.details.structuralFeatures.slice(0, 2).join(', ')}
                      </div>
                    )}
                    {variant.details.fantasyFeatures && variant.details.fantasyFeatures.length > 0 && (
                      <div className="detail-section">
                        <strong>Fantasy Features:</strong> {variant.details.fantasyFeatures.slice(0, 2).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Design Action Button */}
      <div className="variant-selector-actions">
        <button
          className="create-design-button"
          onClick={onCreateDesign}
          disabled={isCreating}
        >
          {isCreating ? (
            <>
              <span className="spinner">⏳</span>
              Creating 3D Model...
            </>
          ) : (
            <>
              <span className="icon">🎯</span>
              Create Design: {selectedVariantData?.title}
            </>
          )}
        </button>
        {selectedVariantData?.fantasyMode && (
          <p className="fantasy-notice">
            ✨ Fantasy mode: This design will use imaginative elements and may include impossible geometry
          </p>
        )}
      </div>
    </div>
  );
}

VariantSelector.propTypes = {
  variants: PropTypes.arrayOf(
    PropTypes.shape({
      style: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      description: PropTypes.string.isRequired,
      dimensions: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number,
        depth: PropTypes.number,
      }),
      materials: PropTypes.arrayOf(PropTypes.string),
      elements: PropTypes.array,
      details: PropTypes.object,
      metadata: PropTypes.object,
      fantasyMode: PropTypes.bool,
    })
  ).isRequired,
  selectedVariant: PropTypes.number.isRequired,
  onVariantSelect: PropTypes.func.isRequired,
  onCreateDesign: PropTypes.func.isRequired,
  isCreating: PropTypes.bool,
};

VariantSelector.defaultProps = {
  isCreating: false,
};

export default VariantSelector;
