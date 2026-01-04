/**
 * AnimationSystem - IMAX/AAA Quality Animation & Keyframing
 * Professional animation system with timeline, keyframes, and interpolation
 */

import * as THREE from 'three';

export class Keyframe {
    constructor(frame, property, value) {
        this.frame = frame;
        this.property = property; // 'position.x', 'rotation.y', 'scale.z', etc.
        this.value = value;
        this.interpolation = 'linear'; // 'linear', 'bezier', 'constant'
        this.easing = 'linear'; // 'linear', 'easeIn', 'easeOut', 'easeInOut'
    }
}

export class AnimationTrack {
    constructor(objectId, property) {
        this.objectId = objectId;
        this.property = property;
        this.keyframes = [];
    }

    /**
     * Add keyframe to track
     */
    addKeyframe(frame, value) {
        const existing = this.keyframes.findIndex(kf => kf.frame === frame);

        if (existing !== -1) {
            // Update existing keyframe
            this.keyframes[existing].value = value;
        } else {
            // Insert new keyframe in sorted order
            const kf = new Keyframe(frame, this.property, value);
            this.keyframes.push(kf);
            this.keyframes.sort((a, b) => a.frame - b.frame);
        }
    }

    /**
     * Remove keyframe at frame
     */
    removeKeyframe(frame) {
        const index = this.keyframes.findIndex(kf => kf.frame === frame);
        if (index !== -1) {
            this.keyframes.splice(index, 1);
        }
    }

    /**
     * Get interpolated value at frame
     */
    getValueAtFrame(frame) {
        if (this.keyframes.length === 0) return null;
        if (this.keyframes.length === 1) return this.keyframes[0].value;

        // Find surrounding keyframes
        let prevKf = null;
        let nextKf = null;

        for (let i = 0; i < this.keyframes.length; i++) {
            if (this.keyframes[i].frame <= frame) {
                prevKf = this.keyframes[i];
            }
            if (this.keyframes[i].frame >= frame && !nextKf) {
                nextKf = this.keyframes[i];
                break;
            }
        }

        // Handle edge cases
        if (!prevKf) return nextKf.value;
        if (!nextKf) return prevKf.value;
        if (prevKf.frame === nextKf.frame) return prevKf.value;

        // Interpolate between keyframes
        const t = (frame - prevKf.frame) / (nextKf.frame - prevKf.frame);
        const easedT = this.applyEasing(t, prevKf.easing);

        return this.interpolate(prevKf.value, nextKf.value, easedT);
    }

    /**
     * Interpolate between two values
     */
    interpolate(start, end, t) {
        if (typeof start === 'number') {
            return start + (end - start) * t;
        }

        // Vector3 interpolation
        if (start.isVector3) {
            return new THREE.Vector3().lerpVectors(start, end, t);
        }

        // Quaternion interpolation (for rotations)
        if (start.isQuaternion) {
            return new THREE.Quaternion().slerpQuaternions(start, end, t);
        }

        return start; // Fallback
    }

    /**
     * Apply easing function to t
     */
    applyEasing(t, easing) {
        switch (easing) {
            case 'easeIn':
                return t * t;
            case 'easeOut':
                return t * (2 - t);
            case 'easeInOut':
                return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            case 'linear':
            default:
                return t;
        }
    }
}

export class AnimationSystem {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;

        // Animation state
        this.tracks = new Map(); // objectId -> Map(property -> AnimationTrack)
        this.currentFrame = 0;
        this.totalFrames = 250;
        this.fps = 30;
        this.isPlaying = false;
        this.loop = true;

        // Playback
        this.playbackStartTime = null;
        this.animationFrameId = null;

        // Auto-keying
        this.autoKeyEnabled = false;
    }

    /**
     * Insert keyframe for object property
     */
    insertKeyframe(objectId, property, value, frame = null) {
        const frameNumber = frame !== null ? frame : this.currentFrame;

        if (!this.tracks.has(objectId)) {
            this.tracks.set(objectId, new Map());
        }

        const objectTracks = this.tracks.get(objectId);

        if (!objectTracks.has(property)) {
            objectTracks.set(property, new AnimationTrack(objectId, property));
        }

        const track = objectTracks.get(property);
        track.addKeyframe(frameNumber, value);

        console.log(`🎬 Keyframe inserted: ${objectId}.${property} at frame ${frameNumber}`);
    }

    /**
     * Insert keyframes for all transform properties of object
     */
    insertTransformKeyframes(objectId, frame = null) {
        const frameNumber = frame !== null ? frame : this.currentFrame;
        const object = this.sceneManager.getObject(objectId);

        if (!object) {
            console.error('Object not found:', objectId);
            return;
        }

        // Insert keyframes for position, rotation, scale
        if (object.position) {
            this.insertKeyframe(objectId, 'position.x', object.position.x, frameNumber);
            this.insertKeyframe(objectId, 'position.y', object.position.y, frameNumber);
            this.insertKeyframe(objectId, 'position.z', object.position.z, frameNumber);
        }

        if (object.rotation) {
            this.insertKeyframe(objectId, 'rotation.x', object.rotation.x, frameNumber);
            this.insertKeyframe(objectId, 'rotation.y', object.rotation.y, frameNumber);
            this.insertKeyframe(objectId, 'rotation.z', object.rotation.z, frameNumber);
        }

        if (object.scale) {
            this.insertKeyframe(objectId, 'scale.x', object.scale.x, frameNumber);
            this.insertKeyframe(objectId, 'scale.y', object.scale.y, frameNumber);
            this.insertKeyframe(objectId, 'scale.z', object.scale.z, frameNumber);
        }

        console.log(`🎬 Transform keyframes inserted for ${objectId} at frame ${frameNumber}`);
    }

    /**
     * Remove keyframe
     */
    removeKeyframe(objectId, property, frame) {
        const objectTracks = this.tracks.get(objectId);
        if (!objectTracks) return;

        const track = objectTracks.get(property);
        if (track) {
            track.removeKeyframe(frame);
        }
    }

    /**
     * Set current frame and update scene
     */
    setFrame(frame) {
        this.currentFrame = Math.max(0, Math.min(frame, this.totalFrames));
        this.updateScene();
    }

    /**
     * Update scene objects based on current frame
     */
    updateScene() {
        this.tracks.forEach((objectTracks, objectId) => {
            const object = this.sceneManager.getObject(objectId);
            if (!object) return;

            objectTracks.forEach((track, property) => {
                const value = track.getValueAtFrame(this.currentFrame);
                if (value === null) return;

                // Apply value to object property
                const parts = property.split('.');
                if (parts.length === 2) {
                    const [prop, axis] = parts;
                    if (object[prop] && object[prop][axis] !== undefined) {
                        object[prop][axis] = value;
                    }
                }
            });
        });
    }

    /**
     * Start playback
     */
    play() {
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.playbackStartTime = performance.now();
        const startFrame = this.currentFrame;

        const animate = () => {
            if (!this.isPlaying) return;

            const elapsed = (performance.now() - this.playbackStartTime) / 1000;
            const framesPassed = Math.floor(elapsed * this.fps);
            this.currentFrame = startFrame + framesPassed;

            if (this.currentFrame >= this.totalFrames) {
                if (this.loop) {
                    this.currentFrame = 0;
                    this.playbackStartTime = performance.now();
                } else {
                    this.stop();
                    return;
                }
            }

            this.updateScene();
            this.animationFrameId = requestAnimationFrame(animate);
        };

        animate();
        console.log('▶️ Playback started');
    }

    /**
     * Pause playback
     */
    pause() {
        this.isPlaying = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        console.log('⏸️ Playback paused');
    }

    /**
     * Stop playback and reset
     */
    stop() {
        this.pause();
        this.setFrame(0);
        console.log('⏹️ Playback stopped');
    }

    /**
     * Get all keyframes for object
     */
    getObjectKeyframes(objectId) {
        const objectTracks = this.tracks.get(objectId);
        if (!objectTracks) return [];

        const allKeyframes = [];
        objectTracks.forEach((track, property) => {
            track.keyframes.forEach(kf => {
                allKeyframes.push({
                    frame: kf.frame,
                    property: kf.property,
                    value: kf.value,
                });
            });
        });

        return allKeyframes.sort((a, b) => a.frame - b.frame);
    }

    /**
     * Clear all animation data
     */
    clearAnimation() {
        this.tracks.clear();
        this.currentFrame = 0;
        console.log('🗑️ Animation cleared');
    }
}
