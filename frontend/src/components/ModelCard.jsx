import PropTypes from 'prop-types';
import '../styles/ModelCard.css';

/**
 * ModelCard Component
 * Displays a Sketchfab model thumbnail with metadata
 */
const ModelCard = ({ model, onClick, selected = false }) => {
  if (!model) return null;

  const thumbnail = model.thumbnails?.images?.[0]?.url || '';
  const title = model.name || 'Untitled';
  const author = model.user?.displayName || model.user?.username || 'Unknown';
  const viewCount = model.viewCount || 0;
  const likeCount = model.likeCount || 0;

  const formatCount = (count) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div
      className={`model-card ${selected ? 'selected' : ''}`}
      onClick={() => onClick && onClick(model)}
      role="button"
      tabIndex={0}
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick && onClick(model);
        }
      }}
    >
      <div className="model-card-thumbnail">
        {thumbnail ? (
          <img src={thumbnail} alt={title} loading="lazy" />
        ) : (
          <div className="model-card-placeholder">
            <span>🎨</span>
          </div>
        )}
        {selected && (
          <div className="model-card-selected-badge">
            <span>✓</span>
          </div>
        )}
      </div>
      
      <div className="model-card-info">
        <h3 className="model-card-title" title={title}>
          {title}
        </h3>
        
        <div className="model-card-author" title={`By ${author}`}>
          <span className="author-icon">👤</span>
          <span className="author-name">{author}</span>
        </div>
        
        <div className="model-card-stats">
          <div className="stat-item" title={`${viewCount} views`}>
            <span className="stat-icon">👁️</span>
            <span className="stat-value">{formatCount(viewCount)}</span>
          </div>
          <div className="stat-item" title={`${likeCount} likes`}>
            <span className="stat-icon">❤️</span>
            <span className="stat-value">{formatCount(likeCount)}</span>
          </div>
        </div>

        {model.isDownloadable && (
          <div className="model-card-badge">
            <span>📥 Downloadable</span>
          </div>
        )}
      </div>
    </div>
  );
};

ModelCard.propTypes = {
  model: PropTypes.shape({
    uid: PropTypes.string,
    name: PropTypes.string,
    thumbnails: PropTypes.shape({
      images: PropTypes.arrayOf(
        PropTypes.shape({
          url: PropTypes.string,
        })
      ),
    }),
    user: PropTypes.shape({
      username: PropTypes.string,
      displayName: PropTypes.string,
    }),
    viewCount: PropTypes.number,
    likeCount: PropTypes.number,
    isDownloadable: PropTypes.bool,
  }).isRequired,
  onClick: PropTypes.func,
  selected: PropTypes.bool,
};

export default ModelCard;
