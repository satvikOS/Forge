import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import '../styles/SketchfabViewer.css';

/**
 * SketchfabViewer Component
 * Embeds and displays Sketchfab 3D models using the Sketchfab Viewer API
 * Documentation: https://sketchfab.com/developers/viewer
 */
const SketchfabViewer = ({
  modelUid,
  autostart = 1,
  autospin = 0,
  ui_controls = 1,
  ui_infos = 1,
  ui_stop = 1,
  ui_inspector = 1,
  ui_watermark = 1,
  ui_help = 1,
  ui_settings = 1,
  ui_vr = 1,
  ui_fullscreen = 1,
  ui_annotations = 1,
  camera = '0',
  transparent = 0,
  preload = 1,
  width = '100%',
  height = '480px',
  onReady = null,
  onError = null,
}) => {
  const iframeRef = useRef(null);
  const [api, setApi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!modelUid) {
      setError('Model UID is required');
      setLoading(false);
      return;
    }

    // Build iframe URL with parameters
    const params = new URLSearchParams({
      autostart: autostart.toString(),
      autospin: autospin.toString(),
      ui_controls: ui_controls.toString(),
      ui_infos: ui_infos.toString(),
      ui_stop: ui_stop.toString(),
      ui_inspector: ui_inspector.toString(),
      ui_watermark: ui_watermark.toString(),
      ui_help: ui_help.toString(),
      ui_settings: ui_settings.toString(),
      ui_vr: ui_vr.toString(),
      ui_fullscreen: ui_fullscreen.toString(),
      ui_annotations: ui_annotations.toString(),
      camera: camera,
      transparent: transparent.toString(),
      preload: preload.toString(),
    });

    const iframeUrl = `https://sketchfab.com/models/${modelUid}/embed?${params.toString()}`;

    // Create iframe
    const iframe = iframeRef.current;
    if (!iframe) return;

    iframe.src = iframeUrl;

    // Initialize Sketchfab API
    const initAPI = () => {
      // Load Sketchfab Viewer API
      if (!window.Sketchfab) {
        const script = document.createElement('script');
        script.src = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js';
        script.async = true;
        script.onload = () => {
          initializeViewer();
        };
        script.onerror = () => {
          setError('Failed to load Sketchfab Viewer API');
          setLoading(false);
          if (onError) onError(new Error('Failed to load Sketchfab Viewer API'));
        };
        document.body.appendChild(script);
      } else {
        initializeViewer();
      }
    };

    const initializeViewer = () => {
      const client = new window.Sketchfab(iframe);

      client.init(modelUid, {
        success: (apiInstance) => {
          console.log('Sketchfab viewer initialized successfully');
          setApi(apiInstance);
          setLoading(false);

          // Add ready listener
          apiInstance.addEventListener('viewerready', () => {
            console.log('Sketchfab viewer ready');
            if (onReady) onReady(apiInstance);
          });
        },
        error: (err) => {
          console.error('Sketchfab API error:', err);
          setError('Failed to initialize Sketchfab viewer');
          setLoading(false);
          if (onError) onError(err);
        },
        ui_stop: ui_stop,
        ui_inspector: ui_inspector,
        ui_controls: ui_controls,
        ui_infos: ui_infos,
        ui_watermark: ui_watermark,
        ui_help: ui_help,
        ui_settings: ui_settings,
        ui_vr: ui_vr,
        ui_fullscreen: ui_fullscreen,
        ui_annotations: ui_annotations,
        autostart: autostart,
        autospin: autospin,
        camera: parseInt(camera, 10),
        transparent: transparent,
        preload: preload,
      });
    };

    // Wait for iframe to load
    iframe.addEventListener('load', initAPI);

    // Cleanup
    return () => {
      iframe.removeEventListener('load', initAPI);
      if (api) {
        // Clean up API if needed
        setApi(null);
      }
    };
  }, [modelUid, autostart, autospin, ui_controls, ui_infos, ui_stop, ui_inspector, 
      ui_watermark, ui_help, ui_settings, ui_vr, ui_fullscreen, ui_annotations, 
      camera, transparent, preload, onReady, onError]);

  if (error) {
    return (
      <div className="sketchfab-viewer-error" style={{ width, height }}>
        <div className="error-content">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sketchfab-viewer-container" style={{ width, height }}>
      {loading && (
        <div className="sketchfab-viewer-loading">
          <div className="loading-spinner"></div>
          <p>Loading 3D model...</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        className="sketchfab-viewer-iframe"
        title="Sketchfab 3D Model Viewer"
        frameBorder="0"
        allowFullScreen
        mozallowfullscreen="true"
        webkitallowfullscreen="true"
        allow="autoplay; fullscreen; xr-spatial-tracking"
        xr-spatial-tracking="true"
        execution-while-out-of-viewport="true"
        execution-while-not-rendered="true"
        web-share="true"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          opacity: loading ? 0 : 1,
          transition: 'opacity 0.3s ease',
        }}
      />
    </div>
  );
};

SketchfabViewer.propTypes = {
  modelUid: PropTypes.string.isRequired,
  autostart: PropTypes.number,
  autospin: PropTypes.number,
  ui_controls: PropTypes.number,
  ui_infos: PropTypes.number,
  ui_stop: PropTypes.number,
  ui_inspector: PropTypes.number,
  ui_watermark: PropTypes.number,
  ui_help: PropTypes.number,
  ui_settings: PropTypes.number,
  ui_vr: PropTypes.number,
  ui_fullscreen: PropTypes.number,
  ui_annotations: PropTypes.number,
  camera: PropTypes.string,
  transparent: PropTypes.number,
  preload: PropTypes.number,
  width: PropTypes.string,
  height: PropTypes.string,
  onReady: PropTypes.func,
  onError: PropTypes.func,
};

export default SketchfabViewer;
