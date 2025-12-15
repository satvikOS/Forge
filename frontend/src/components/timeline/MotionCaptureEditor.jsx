/**
 * Motion Capture Editor - AI-powered motion extraction from video
 * Uses AWS Bedrock Multimodal API to analyze video and generate keyframes
 */

import { useState, useRef } from 'react';

export default function MotionCaptureEditor({ onClose, currentFrame, onFrameChange }) {
    const [videoFile, setVideoFile] = useState(null);
    const [videoUrl, setVideoUrl] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [extractedMotion, setExtractedMotion] = useState(null);
    const [analysisProgress, setAnalysisProgress] = useState(0);
    const videoRef = useRef();
    const fileInputRef = useRef();

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('video/')) {
            setVideoFile(file);
            const url = URL.createObjectURL(file);
            setVideoUrl(url);
        } else {
            alert('Please select a valid video file');
        }
    };

    const handleAnalyzeVideo = async () => {
        if (!videoFile) {
            alert('Please select a video file first');
            return;
        }

        setIsAnalyzing(true);
        setAnalysisProgress(0);

        try {
            // Create FormData for video upload
            const formData = new FormData();
            formData.append('video', videoFile);
            formData.append('fps', '30');
            formData.append('analysisType', 'motion_capture');

            // Send to backend for AI analysis
            const response = await fetch('/api/motion-capture/analyze', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Motion analysis failed');
            }

            const result = await response.json();

            setExtractedMotion(result.motion);
            setAnalysisProgress(100);
            console.log('✅ Motion capture analysis complete:', result);

        } catch (error) {
            console.error('❌ Motion capture error:', error);
            alert('Failed to analyze video: ' + error.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleApplyToCharacter = () => {
        if (!extractedMotion) {
            alert('No motion data available. Please analyze a video first.');
            return;
        }

        // TODO: Apply motion to selected character in scene
        console.log('Applying motion to character:', extractedMotion);
        alert('Motion applied to character! (Feature in development)');
    };

    const handleSeekToFrame = (frame) => {
        if (videoRef.current && extractedMotion) {
            const time = frame / 30; // Assuming 30 fps
            videoRef.current.currentTime = time;
            if (onFrameChange) {
                onFrameChange(frame);
            }
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h3 style={styles.title}>
                    <span>🎥</span>
                    <span>Motion Capture Editor</span>
                </h3>
                <button onClick={onClose} style={styles.closeButton}>×</button>
            </div>

            <div style={styles.content}>
                {/* Video Upload Section */}
                <div style={styles.section}>
                    <div style={styles.uploadArea}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/*"
                            onChange={handleFileSelect}
                            style={styles.hiddenInput}
                        />
                        {!videoUrl ? (
                            <div
                                style={styles.uploadPrompt}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <div style={styles.uploadIcon}>📹</div>
                                <div style={styles.uploadText}>Click to upload video</div>
                                <div style={styles.uploadHint}>MP4, MOV, AVI supported</div>
                            </div>
                        ) : (
                            <div style={styles.videoContainer}>
                                <video
                                    ref={videoRef}
                                    src={videoUrl}
                                    controls
                                    style={styles.video}
                                    onTimeUpdate={(e) => {
                                        const currentTime = e.target.currentTime;
                                        const frame = Math.floor(currentTime * 30);
                                        if (onFrameChange) {
                                            onFrameChange(frame);
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    style={styles.changeVideoButton}
                                >
                                    Change Video
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Analysis Controls */}
                {videoUrl && (
                    <div style={styles.section}>
                        <div style={styles.controlsRow}>
                            <button
                                onClick={handleAnalyzeVideo}
                                disabled={isAnalyzing}
                                style={{
                                    ...styles.primaryButton,
                                    ...(isAnalyzing ? styles.disabledButton : {})
                                }}
                            >
                                {isAnalyzing ? (
                                    <>
                                        <span className="spinner">⏳</span>
                                        <span>Analyzing with AI...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>🤖</span>
                                        <span>Analyze Motion with AI</span>
                                    </>
                                )}
                            </button>

                            {extractedMotion && (
                                <button
                                    onClick={handleApplyToCharacter}
                                    style={styles.secondaryButton}
                                >
                                    <span>✅</span>
                                    <span>Apply to Character</span>
                                </button>
                            )}
                        </div>

                        {isAnalyzing && (
                            <div style={styles.progressBar}>
                                <div
                                    style={{
                                        ...styles.progressFill,
                                        width: `${analysisProgress}%`
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Motion Data Visualization */}
                {extractedMotion && (
                    <div style={styles.section}>
                        <h4 style={styles.sectionTitle}>Extracted Motion Data</h4>
                        <div style={styles.motionData}>
                            <div style={styles.motionStat}>
                                <span style={styles.statLabel}>Keyframes:</span>
                                <span style={styles.statValue}>{extractedMotion.keyframes?.length || 0}</span>
                            </div>
                            <div style={styles.motionStat}>
                                <span style={styles.statLabel}>Duration:</span>
                                <span style={styles.statValue}>{extractedMotion.duration || 0}s</span>
                            </div>
                            <div style={styles.motionStat}>
                                <span style={styles.statLabel}>Joints Tracked:</span>
                                <span style={styles.statValue}>{extractedMotion.joints?.length || 0}</span>
                            </div>
                        </div>

                        {/* Keyframe List */}
                        <div style={styles.keyframeList}>
                            {extractedMotion.keyframes?.slice(0, 10).map((kf, idx) => (
                                <div
                                    key={idx}
                                    style={styles.keyframeItem}
                                    onClick={() => handleSeekToFrame(kf.frame)}
                                >
                                    <span style={styles.keyframeFrame}>Frame {kf.frame}</span>
                                    <span style={styles.keyframeType}>{kf.type || 'pose'}</span>
                                </div>
                            ))}
                            {extractedMotion.keyframes?.length > 10 && (
                                <div style={styles.moreKeyframes}>
                                    +{extractedMotion.keyframes.length - 10} more keyframes
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Info Panel */}
                <div style={styles.infoPanel}>
                    <div style={styles.infoTitle}>💡 How it works</div>
                    <ul style={styles.infoList}>
                        <li>Upload a video containing motion you want to capture</li>
                        <li>AI analyzes the video and extracts motion data</li>
                        <li>Keyframes are automatically generated for character animation</li>
                        <li>Apply the motion to any character rig in your scene</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

const styles = {
    container: {
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        color: '#e0e0e0',
    },
    header: {
        height: '48px',
        backgroundColor: '#2a2a2a',
        borderBottom: '1px solid #444',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
    },
    title: {
        margin: 0,
        fontSize: '14px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    closeButton: {
        background: 'none',
        border: 'none',
        color: '#999',
        fontSize: '24px',
        cursor: 'pointer',
        padding: '0 8px',
        lineHeight: '20px',
    },
    content: {
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
    },
    section: {
        backgroundColor: '#222',
        borderRadius: '8px',
        padding: '16px',
        border: '1px solid #333',
    },
    uploadArea: {
        minHeight: '200px',
    },
    hiddenInput: {
        display: 'none',
    },
    uploadPrompt: {
        height: '200px',
        border: '2px dashed #444',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s',
    },
    uploadIcon: {
        fontSize: '48px',
        marginBottom: '12px',
    },
    uploadText: {
        fontSize: '14px',
        color: '#e0e0e0',
        marginBottom: '4px',
    },
    uploadHint: {
        fontSize: '12px',
        color: '#999',
    },
    videoContainer: {
        position: 'relative',
    },
    video: {
        width: '100%',
        maxHeight: '300px',
        backgroundColor: '#000',
        borderRadius: '8px',
    },
    changeVideoButton: {
        marginTop: '8px',
        padding: '6px 12px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '4px',
        color: '#e0e0e0',
        cursor: 'pointer',
        fontSize: '12px',
    },
    controlsRow: {
        display: 'flex',
        gap: '12px',
    },
    primaryButton: {
        flex: 1,
        padding: '12px 16px',
        backgroundColor: '#4a90e2',
        border: 'none',
        borderRadius: '6px',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        transition: 'background-color 0.2s',
    },
    secondaryButton: {
        flex: 1,
        padding: '12px 16px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #4a90e2',
        borderRadius: '6px',
        color: '#4a90e2',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
    },
    disabledButton: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
    progressBar: {
        marginTop: '12px',
        height: '4px',
        backgroundColor: '#333',
        borderRadius: '2px',
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#4a90e2',
        transition: 'width 0.3s',
    },
    sectionTitle: {
        margin: '0 0 12px 0',
        fontSize: '13px',
        fontWeight: '600',
        color: '#4a90e2',
    },
    motionData: {
        display: 'flex',
        gap: '16px',
        marginBottom: '16px',
    },
    motionStat: {
        flex: 1,
        padding: '12px',
        backgroundColor: '#1a1a1a',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    statLabel: {
        fontSize: '11px',
        color: '#999',
        textTransform: 'uppercase',
    },
    statValue: {
        fontSize: '18px',
        color: '#4a90e2',
        fontWeight: '600',
    },
    keyframeList: {
        maxHeight: '150px',
        overflowY: 'auto',
    },
    keyframeItem: {
        padding: '8px 12px',
        backgroundColor: '#1a1a1a',
        borderRadius: '4px',
        marginBottom: '4px',
        display: 'flex',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
    },
    keyframeFrame: {
        fontSize: '12px',
        color: '#e0e0e0',
    },
    keyframeType: {
        fontSize: '11px',
        color: '#999',
        textTransform: 'uppercase',
    },
    moreKeyframes: {
        padding: '8px',
        textAlign: 'center',
        fontSize: '11px',
        color: '#666',
    },
    infoPanel: {
        backgroundColor: '#2a2a2a',
        borderRadius: '6px',
        padding: '12px',
        border: '1px solid #444',
    },
    infoTitle: {
        fontSize: '12px',
        fontWeight: '600',
        marginBottom: '8px',
        color: '#4a90e2',
    },
    infoList: {
        margin: 0,
        paddingLeft: '20px',
        fontSize: '11px',
        color: '#999',
        lineHeight: '1.6',
    },
};
