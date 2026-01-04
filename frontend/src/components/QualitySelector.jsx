import { useState, useEffect } from 'react';
import api from '../services/api';

/**
 * QualitySelector Component
 * UI for selecting generation quality with cost estimation
 */
export default function QualitySelector({ prompt, onQualitySelect, disabled = false }) {
  const [selectedQuality, setSelectedQuality] = useState('preview');
  const [estimate, setEstimate] = useState(null);
  const [credits, setCredits] = useState(null);
  const [loading, setLoading] = useState(false);

  // Quality options
  const qualityOptions = [
    {
      id: 'preview',
      name: 'Preview (FREE)',
      description: 'Quick preview using free tier only',
      time: '30 seconds',
      cost: '$0.00',
      icon: '⚡',
      color: '#10b981',
    },
    {
      id: 'balanced',
      name: 'Balanced',
      description: 'Good quality with multi-view generation',
      time: '45 seconds',
      cost: '$0.02 - $0.20',
      icon: '⚖️',
      color: '#3b82f6',
    },
    {
      id: 'high_quality',
      name: 'High Quality',
      description: 'AAA-grade with PBR materials',
      time: '60 seconds',
      cost: '$0.40',
      icon: '💎',
      color: '#8b5cf6',
    },
  ];

  // Load credits and estimate on mount
  useEffect(() => {
    loadCreditsAndEstimate();
  }, [prompt]);

  const loadCreditsAndEstimate = async () => {
    if (!prompt) return;

    setLoading(true);
    try {
      // Load credit status
      const creditsResponse = await api.getCreditStatus();
      setCredits(creditsResponse.status);

      // Get cost estimate
      const estimateResponse = await api.estimateGenerationCost(prompt, selectedQuality);
      setEstimate(estimateResponse.estimate);
    } catch (error) {
      console.error('Error loading credits/estimate:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleQualityChange = (qualityId) => {
    setSelectedQuality(qualityId);
    if (onQualitySelect) {
      onQualitySelect(qualityId);
    }
  };

  return (
    <div style={{
      background: 'rgba(26, 26, 26, 0.95)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '16px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '16px',
          fontWeight: 600,
          color: '#fff',
        }}>
          🎨 Select Generation Quality
        </h3>
        
        {/* Credits status */}
        {credits && (
          <div style={{
            fontSize: '12px',
            color: '#9ca3af',
            display: 'flex',
            gap: '12px',
          }}>
            <span>💰 Budget: ${credits.budget.remaining.toFixed(2)} / ${credits.budget.max}</span>
            <span>🎟️ Free: {credits.tripo.remaining + credits.meshy.remaining + credits.vertexImagen.remaining} credits</span>
          </div>
        )}
      </div>

      {/* Quality options grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        marginBottom: '16px',
      }}>
        {qualityOptions.map((option) => (
          <button
            key={option.id}
            onClick={() => handleQualityChange(option.id)}
            disabled={disabled || loading}
            style={{
              position: 'relative',
              background: selectedQuality === option.id 
                ? `linear-gradient(135deg, ${option.color}20, ${option.color}10)`
                : 'rgba(255, 255, 255, 0.05)',
              border: `2px solid ${selectedQuality === option.id ? option.color : 'rgba(255, 255, 255, 0.1)'}`,
              borderRadius: '8px',
              padding: '16px',
              cursor: disabled || loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              textAlign: 'left',
              opacity: disabled || loading ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!disabled && !loading) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 4px 12px ${option.color}40`;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {/* Icon */}
            <div style={{
              fontSize: '24px',
              marginBottom: '8px',
            }}>
              {option.icon}
            </div>

            {/* Name */}
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#fff',
              marginBottom: '4px',
            }}>
              {option.name}
            </div>

            {/* Description */}
            <div style={{
              fontSize: '12px',
              color: '#9ca3af',
              marginBottom: '8px',
              lineHeight: '1.4',
            }}>
              {option.description}
            </div>

            {/* Metadata */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '11px',
              color: '#6b7280',
            }}>
              <span>⏱️ {option.time}</span>
              <span style={{ fontWeight: 600, color: option.color }}>
                {option.cost}
              </span>
            </div>

            {/* Selected indicator */}
            {selectedQuality === option.id && (
              <div style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: option.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
              }}>
                ✓
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Estimate details */}
      {estimate && (
        <div style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          padding: '12px',
          fontSize: '12px',
          color: '#9ca3af',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <strong style={{ color: '#fff' }}>Estimated Cost:</strong> ${estimate.estimatedCostUSD.toFixed(4)}
            {estimate.useFreeTier && (
              <span style={{ 
                marginLeft: '8px', 
                padding: '2px 8px', 
                background: '#10b98140', 
                color: '#10b981',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
              }}>
                FREE TIER
              </span>
            )}
          </div>
          <div>
            Provider: <strong style={{ color: '#fff' }}>{estimate.provider}</strong>
          </div>
        </div>
      )}

      {/* Warning if approaching budget */}
      {credits && credits.budget.percentUsed > 75 && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          background: 'rgba(251, 191, 36, 0.1)',
          border: '1px solid rgba(251, 191, 36, 0.3)',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#fbbf24',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>⚠️</span>
          <span>
            {credits.budget.percentUsed >= 95 
              ? 'Budget limit reached! Generation may be blocked.'
              : `Warning: ${credits.budget.percentUsed.toFixed(0)}% of monthly budget used.`
            }
          </span>
        </div>
      )}
    </div>
  );
}
