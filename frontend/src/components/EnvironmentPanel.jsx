/**
 * Environment Panel Component - Panel for environment controls and asset browser
 */

import { useState } from 'react';
import AssetBrowser from './AssetBrowser';
import SceneComposerPanel from './SceneComposerPanel';

export default function EnvironmentPanel({ assetManager, sceneComposer, onAddAsset, onSceneGenerated }) {
  const [activeTab, setActiveTab] = useState('composer');

  const tabs = [
    { id: 'composer', label: 'Scene Composer', icon: '🎨' },
    { id: 'assets', label: 'Assets', icon: '📦' },
    { id: 'presets', label: 'Presets', icon: '🎭' },
  ];

  const handleAssetSelect = (asset) => {
    if (onAddAsset) {
      onAddAsset(asset);
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
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          fontWeight: '600',
          color: 'var(--text-primary)',
        }}>
          Environment Assets
        </h3>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '6px 12px',
              background: activeTab === tab.id ? 'var(--accent-color)' : 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: activeTab === tab.id ? 'white' : 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'composer' && sceneComposer && (
          <SceneComposerPanel
            sceneComposer={sceneComposer}
            onSceneGenerated={onSceneGenerated}
          />
        )}
        {activeTab === 'assets' && (
          <AssetBrowser
            assetManager={assetManager}
            onAssetSelect={handleAssetSelect}
          />
        )}
        {activeTab === 'presets' && (
          <PresetsPanel />
        )}
      </div>
    </div>
  );
}

// Presets Panel Component
function PresetsPanel() {
  const presets = [
    { id: 'urban', name: 'Urban Scene', icon: '🏙️', description: 'City environment with buildings and roads' },
    { id: 'natural', name: 'Natural Landscape', icon: '🌲', description: 'Forest and mountains' },
    { id: 'coastal', name: 'Coastal Area', icon: '🏖️', description: 'Beach with water' },
    { id: 'desert', name: 'Desert', icon: '🏜️', description: 'Arid desert landscape' },
    { id: 'industrial', name: 'Industrial Zone', icon: '🏭', description: 'Factories and warehouses' },
    { id: 'rural', name: 'Rural Farmland', icon: '🌾', description: 'Fields and farms' },
  ];

  return (
    <div style={{
      padding: '12px',
      overflowY: 'auto',
      height: '100%',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '12px',
      }}>
        {presets.map(preset => (
          <div
            key={preset.id}
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '16px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)';
              e.currentTarget.style.transform = 'translateX(4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.transform = 'translateX(0)';
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '8px',
            }}>
              <div style={{
                fontSize: '32px',
                width: '48px',
                height: '48px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
              }}>
                {preset.icon}
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{
                  margin: '0 0 4px 0',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                }}>
                  {preset.name}
                </h4>
                <p style={{
                  margin: 0,
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.4',
                }}>
                  {preset.description}
                </p>
              </div>
            </div>
            <button
              style={{
                width: '100%',
                padding: '6px',
                background: 'var(--accent-color)',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: '500',
              }}
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Apply preset
                console.log('Apply preset:', preset.id);
              }}
            >
              Apply Preset
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
