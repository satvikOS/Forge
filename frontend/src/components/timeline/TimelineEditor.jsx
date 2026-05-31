/**
 * Timeline Editor - Professional timeline component for animation and motion capture
 * Replaces/augments bottom prompt bar with Cinema 4D/Blender-style timeline
 */

import { useState, useRef, useEffect } from 'react';
import MotionCaptureEditor from './MotionCaptureEditor';

export default function TimelineEditor({
    sceneManager,
    currentFrame = 0,
    totalFrames = 250,
    fps = 30,
    onFrameChange,
    onPlayPause,
    isPlaying = false,
}) {
    const [selectedLayers, setSelectedLayers] = useState([]);
    const [showMotionCapture, setShowMotionCapture] = useState(false);
    const [zoom, setZoom] = useState(1.0);
    const timelineRef = useRef();

    // Get scene objects for timeline layers
    const layers = sceneManager ? sceneManager.getAllObjects().map(obj => ({
        id: obj.id,
        name: obj.name || 'Unnamed Object',
        keyframes: obj.userData?.keyframes || [],
        visible: obj.visible !== false,
        locked: obj.userData?.locked || false,
    })) : [];

    const handleFrameClick = (frame) => {
        if (onFrameChange) {
            onFrameChange(frame);
        }
    };

    const handlePlayPauseClick = () => {
        if (onPlayPause) {
            onPlayPause(!isPlaying);
        }
    };

    const formatTime = (frame) => {
        const totalSeconds = frame / fps;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const frames = frame % fps;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
    };

    return (
        <div style={styles.container}>
            {/* Top Controls Bar */}
            <div style={styles.controlsBar}>
                {/* Playback Controls */}
                <div style={styles.playbackControls}>
                    <button style={styles.controlButton} title="First Frame">
                        <span>⏮</span>
                    </button>
                    <button style={styles.controlButton} title="Previous Frame">
                        <span>◀</span>
                    </button>
                    <button
                        style={{ ...styles.controlButton, ...styles.playButton }}
                        onClick={handlePlayPauseClick}
                        title={isPlaying ? "Pause" : "Play"}
                    >
                        <span>{isPlaying ? '⏸' : '▶'}</span>
                    </button>
                    <button style={styles.controlButton} title="Next Frame">
                        <span>▶</span>
                    </button>
                    <button style={styles.controlButton} title="Last Frame">
                        <span>⏭</span>
                    </button>
                    <button style={styles.controlButton} title="Loop">
                        <span>🔁</span>
                    </button>
                </div>

                {/* Frame Display */}
                <div style={styles.frameDisplay}>
                    <input
                        type="number"
                        value={currentFrame}
                        onChange={(e) => handleFrameClick(parseInt(e.target.value) || 0)}
                        style={styles.frameInput}
                        min="0"
                        max={totalFrames}
                    />
                    <span style={styles.frameSeparator}>/</span>
                    <span style={styles.totalFrames}>{totalFrames}</span>
                    <span style={styles.timeDisplay}>{formatTime(currentFrame)}</span>
                </div>

                {/* Right Controls */}
                <div style={styles.rightControls}>
                    <button
                        style={{
                            ...styles.controlButton,
                            ...(showMotionCapture ? styles.activeButton : {})
                        }}
                        onClick={() => setShowMotionCapture(!showMotionCapture)}
                        title="Motion Capture Editor"
                    >
                        <span>🎥</span>
                        <span style={styles.buttonLabel}>Motion Capture</span>
                    </button>

                    <div style={styles.zoomControls}>
                        <button
                            style={styles.controlButton}
                            onClick={() => setZoom(Math.max(0.1, zoom - 0.1))}
                            title="Zoom Out"
                        >
                            <span>−</span>
                        </button>
                        <span style={styles.zoomDisplay}>{(zoom * 100).toFixed(0)}%</span>
                        <button
                            style={styles.controlButton}
                            onClick={() => setZoom(Math.min(5.0, zoom + 0.1))}
                            title="Zoom In"
                        >
                            <span>+</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Timeline Tracks */}
            <div style={styles.timelineContent}>
                {/* Layer List */}
                <div style={styles.layerList}>
                    <div style={styles.layerListHeader}>
                        <span style={styles.layerListTitle}>Layers</span>
                    </div>
                    <div style={styles.layerListContent}>
                        {layers.length === 0 ? (
                            <div style={styles.emptyMessage}>No objects in scene</div>
                        ) : (
                            layers.map((layer) => (
                                <div
                                    key={layer.id}
                                    style={{
                                        ...styles.layerItem,
                                        ...(selectedLayers.includes(layer.id) ? styles.selectedLayer : {})
                                    }}
                                    onClick={() => {
                                        setSelectedLayers(prev =>
                                            prev.includes(layer.id)
                                                ? prev.filter(id => id !== layer.id)
                                                : [...prev, layer.id]
                                        );
                                    }}
                                >
                                    <span style={styles.visibilityIcon}>{layer.visible ? '👁' : '🚫'}</span>
                                    <span style={styles.layerName}>{layer.name}</span>
                                    {layer.locked && <span style={styles.lockIcon}>🔒</span>}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Timeline Grid */}
                <div style={styles.timelineGrid} ref={timelineRef}>
                    {/* Frame Ruler */}
                    <div style={styles.frameRuler}>
                        {Array.from({ length: Math.ceil(totalFrames / 10) + 1 }, (_, i) => i * 10).map(frame => (
                            <div
                                key={frame}
                                style={{
                                    ...styles.frameMarker,
                                    left: `${(frame / totalFrames) * 100}%`,
                                }}
                            >
                                <span style={styles.frameNumber}>{frame}</span>
                            </div>
                        ))}
                    </div>

                    {/* Playhead */}
                    <div
                        style={{
                            ...styles.playhead,
                            left: `${(currentFrame / totalFrames) * 100}%`,
                        }}
                    >
                        <div style={styles.playheadHandle} />
                        <div style={styles.playheadLine} />
                    </div>

                    {/* Keyframe Tracks */}
                    <div style={styles.keyframeTracks}>
                        {layers.map((layer) => (
                            <div key={layer.id} style={styles.track}>
                                {layer.keyframes.map((kf, idx) => (
                                    <div
                                        key={idx}
                                        style={{
                                            ...styles.keyframe,
                                            left: `${(kf.frame / totalFrames) * 100}%`,
                                        }}
                                        title={`Frame ${kf.frame}`}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Motion Capture Editor (if enabled) */}
            {showMotionCapture && (
                <div style={styles.motionCapturePanel}>
                    <MotionCaptureEditor
                        onClose={() => setShowMotionCapture(false)}
                        currentFrame={currentFrame}
                        onFrameChange={handleFrameClick}
                    />
                </div>
            )}
        </div>
    );
}

const styles = {
    container: {
        width: '100%',
        height: '25vh',
        backgroundColor: '#1a1a1a',
        borderTop: '1px solid #444',
        display: 'flex',
        flexDirection: 'column',
        color: '#e0e0e0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    controlsBar: {
        height: '48px',
        backgroundColor: '#2a2a2a',
        borderBottom: '1px solid #444',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: '20px',
    },
    playbackControls: {
        display: 'flex',
        gap: '4px',
    },
    controlButton: {
        width: '32px',
        height: '32px',
        backgroundColor: '#1a1a1a',
        border: '1px solid #444',
        borderRadius: '4px',
        color: '#e0e0e0',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        transition: 'all 0.2s',
        fontFamily: 'inherit',
    },
    playButton: {
        backgroundColor: '#4a90e2',
        borderColor: '#4a90e2',
    },
    activeButton: {
        backgroundColor: '#4a90e2',
        borderColor: '#4a90e2',
    },
    buttonLabel: {
        marginLeft: '6px',
        fontSize: '12px',
    },
    frameDisplay: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
    },
    frameInput: {
        width: '60px',
        padding: '6px',
        backgroundColor: '#1a1a1a',
        border: '1px solid #444',
        borderRadius: '4px',
        color: '#e0e0e0',
        textAlign: 'center',
        fontSize: '13px',
    },
    frameSeparator: {
        color: '#666',
    },
    totalFrames: {
        color: '#999',
    },
    timeDisplay: {
        marginLeft: '8px',
        color: '#4a90e2',
        fontFamily: 'monospace',
        fontSize: '14px',
    },
    rightControls: {
        marginLeft: 'auto',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
    },
    zoomControls: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center',
    },
    zoomDisplay: {
        fontSize: '12px',
        color: '#999',
        minWidth: '45px',
        textAlign: 'center',
    },
    timelineContent: {
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
    },
    layerList: {
        width: '200px',
        backgroundColor: '#222',
        borderRight: '1px solid #444',
        display: 'flex',
        flexDirection: 'column',
    },
    layerListHeader: {
        height: '32px',
        backgroundColor: '#2a2a2a',
        borderBottom: '1px solid #444',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
    },
    layerListTitle: {
        fontSize: '12px',
        fontWeight: '600',
        color: '#999',
        textTransform: 'uppercase',
    },
    layerListContent: {
        flex: 1,
        overflowY: 'auto',
    },
    emptyMessage: {
        padding: '20px',
        textAlign: 'center',
        color: '#666',
        fontSize: '12px',
    },
    layerItem: {
        height: '28px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: '8px',
        cursor: 'pointer',
        borderBottom: '1px solid #333',
        transition: 'background-color 0.2s',
    },
    selectedLayer: {
        backgroundColor: '#4a90e233',
        borderLeft: '2px solid #4a90e2',
    },
    visibilityIcon: {
        fontSize: '12px',
    },
    layerName: {
        fontSize: '12px',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    lockIcon: {
        fontSize: '10px',
    },
    timelineGrid: {
        flex: 1,
        position: 'relative',
        backgroundColor: '#1a1a1a',
        overflow: 'auto',
    },
    frameRuler: {
        height: '32px',
        backgroundColor: '#2a2a2a',
        borderBottom: '1px solid #444',
        position: 'relative',
    },
    frameMarker: {
        position: 'absolute',
        top: 0,
        height: '100%',
        borderLeft: '1px solid #444',
        paddingLeft: '4px',
    },
    frameNumber: {
        fontSize: '10px',
        color: '#999',
    },
    playhead: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        zIndex: 10,
        pointerEvents: 'none',
    },
    playheadHandle: {
        width: '12px',
        height: '12px',
        marginLeft: '-6px',
        backgroundColor: '#ff6b35',
        borderRadius: '2px 2px 0 0',
    },
    playheadLine: {
        width: '2px',
        height: 'calc(100% - 12px)',
        marginLeft: '-1px',
        backgroundColor: '#ff6b35',
    },
    keyframeTracks: {
        marginTop: '32px',
    },
    track: {
        height: '28px',
        borderBottom: '1px solid #333',
        position: 'relative',
    },
    keyframe: {
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '8px',
        height: '8px',
        backgroundColor: '#4a90e2',
        borderRadius: '2px',
        cursor: 'pointer',
        transition: 'all 0.2s',
    },
    motionCapturePanel: {
        height: '200px',
        borderTop: '1px solid #444',
        backgroundColor: '#222',
    },
};
