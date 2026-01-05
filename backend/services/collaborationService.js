/**
 * Real-time Collaboration Service
 * Multi-user CAD collaboration with presence, comments, annotations
 * Live cursor tracking, change notifications, conflict resolution
 * Activity feeds, version control, permissions management
 */

class CollaborationService {
    constructor() {
        this.sessions = new Map();
        this.users = new Map();
        this.comments = new Map();
        this.annotations = new Map();
        this.activityLog = [];
    }

    /**
     * Create collaboration session
     */
    async createSession(spec) {
        const {
            modelId,
            modelName,
            owner,
            participants = [],
            permissions = 'edit',  // 'view', 'comment', 'edit', 'admin'
            features = ['presence', 'comments', 'annotations', 'notifications']
        } = spec;

        console.log(`👥 Collaboration: Creating session for "${modelName}"...`);

        const sessionId = `session_${Date.now()}`;

        const session = {
            sessionId,
            modelId,
            modelName,
            owner,
            participants: [
                {
                    userId: owner.userId,
                    userName: owner.userName,
                    role: 'owner',
                    permissions: 'admin',
                    joinedAt: Date.now(),
                    status: 'active'
                }
            ],
            presence: new Map(),  // userId -> presence data
            comments: [],
            annotations: [],
            changes: [],
            locks: new Map(),  // Feature locks to prevent conflicts
            features,
            createdAt: Date.now()
        };

        // Add other participants
        for (const participant of participants) {
            await this.addParticipant(session, participant, permissions);
        }

        this.sessions.set(sessionId, session);

        console.log(`  ✅ Session created with ${session.participants.length} participant(s)`);

        return {
            success: true,
            operation: 'create-session',
            session,
            sessionUrl: `/api/mechanical/collaborate/${sessionId}`
        };
    }

    /**
     * Add participant to session
     */
    async addParticipant(session, user, permissions) {
        const participant = {
            userId: user.userId,
            userName: user.userName,
            role: 'collaborator',
            permissions,
            joinedAt: Date.now(),
            status: 'active',
            color: this.assignUserColor(session.participants.length)
        };

        session.participants.push(participant);

        // Log activity
        this.logActivity(session, {
            type: 'user-joined',
            userId: user.userId,
            userName: user.userName,
            timestamp: Date.now()
        });

        // Notify other participants
        await this.notifyParticipants(session, {
            type: 'user-joined',
            user: participant
        });

        console.log(`    👤 ${user.userName} joined as ${permissions}`);

        return participant;
    }

    /**
     * Update user presence (cursor, camera, selection)
     */
    async updatePresence(sessionId, userId, presenceData) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const {
            cursor = null,          // 2D screen position
            camera = null,          // 3D camera position and orientation
            selection = null,       // Selected features/faces
            viewport = null,        // Current view (front, top, isometric, etc.)
            isTyping = false,       // Typing in comment/annotation
            lastActivity = Date.now()
        } = presenceData;

        const presence = {
            userId,
            cursor,
            camera,
            selection,
            viewport,
            isTyping,
            lastActivity,
            status: 'active'
        };

        session.presence.set(userId, presence);

        // Broadcast to other users
        await this.broadcastPresence(session, userId, presence);

        return {
            success: true,
            operation: 'update-presence',
            presence
        };
    }

    /**
     * Add comment to model
     */
    async addComment(sessionId, userId, commentData) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const {
            text,
            attachedTo = null,      // Feature, face, edge, or point
            position = null,        // 3D position in model space
            resolved = false,
            priority = 'normal'     // 'low', 'normal', 'high', 'critical'
        } = commentData;

        const user = session.participants.find(p => p.userId === userId);

        const comment = {
            commentId: `comment_${Date.now()}`,
            sessionId,
            userId,
            userName: user.userName,
            userColor: user.color,
            text,
            attachedTo,
            position,
            resolved,
            priority,
            replies: [],
            reactions: {},  // { userId: '👍' }
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        session.comments.push(comment);
        this.comments.set(comment.commentId, comment);

        // Log activity
        this.logActivity(session, {
            type: 'comment-added',
            userId,
            userName: user.userName,
            commentId: comment.commentId,
            text,
            timestamp: Date.now()
        });

        // Notify participants
        await this.notifyParticipants(session, {
            type: 'new-comment',
            comment
        });

        console.log(`    💬 ${user.userName}: "${text}"`);

        return {
            success: true,
            operation: 'add-comment',
            comment
        };
    }

    /**
     * Add reply to comment
     */
    async replyToComment(commentId, userId, replyText) {
        const comment = this.comments.get(commentId);
        if (!comment) {
            throw new Error(`Comment ${commentId} not found`);
        }

        const session = this.sessions.get(comment.sessionId);
        const user = session.participants.find(p => p.userId === userId);

        const reply = {
            replyId: `reply_${Date.now()}`,
            commentId,
            userId,
            userName: user.userName,
            text: replyText,
            createdAt: Date.now()
        };

        comment.replies.push(reply);
        comment.updatedAt = Date.now();

        // Notify participants
        await this.notifyParticipants(session, {
            type: 'comment-reply',
            commentId,
            reply
        });

        return {
            success: true,
            operation: 'reply-to-comment',
            reply
        };
    }

    /**
     * Resolve comment
     */
    async resolveComment(commentId, userId) {
        const comment = this.comments.get(commentId);
        if (!comment) {
            throw new Error(`Comment ${commentId} not found`);
        }

        comment.resolved = true;
        comment.resolvedBy = userId;
        comment.resolvedAt = Date.now();

        const session = this.sessions.get(comment.sessionId);

        // Log activity
        const user = session.participants.find(p => p.userId === userId);
        this.logActivity(session, {
            type: 'comment-resolved',
            userId,
            userName: user.userName,
            commentId,
            timestamp: Date.now()
        });

        // Notify participants
        await this.notifyParticipants(session, {
            type: 'comment-resolved',
            commentId
        });

        return {
            success: true,
            operation: 'resolve-comment',
            comment
        };
    }

    /**
     * Add annotation (markup on model)
     */
    async addAnnotation(sessionId, userId, annotationData) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const {
            type,           // 'arrow', 'circle', 'rectangle', 'freehand', 'text', 'dimension'
            geometry,       // Geometric data for annotation
            text = null,    // Text content if applicable
            style = {},     // Color, line width, etc.
            attachedTo = null
        } = annotationData;

        const user = session.participants.find(p => p.userId === userId);

        const annotation = {
            annotationId: `annotation_${Date.now()}`,
            sessionId,
            userId,
            userName: user.userName,
            type,
            geometry,
            text,
            style: {
                color: user.color,
                lineWidth: 2,
                fontSize: 12,
                ...style
            },
            attachedTo,
            createdAt: Date.now()
        };

        session.annotations.push(annotation);
        this.annotations.set(annotation.annotationId, annotation);

        // Log activity
        this.logActivity(session, {
            type: 'annotation-added',
            userId,
            userName: user.userName,
            annotationId: annotation.annotationId,
            annotationType: type,
            timestamp: Date.now()
        });

        // Broadcast to participants
        await this.notifyParticipants(session, {
            type: 'new-annotation',
            annotation
        });

        return {
            success: true,
            operation: 'add-annotation',
            annotation
        };
    }

    /**
     * Lock feature for editing
     */
    async lockFeature(sessionId, userId, featureId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        // Check if already locked
        if (session.locks.has(featureId)) {
            const existingLock = session.locks.get(featureId);
            if (existingLock.userId !== userId) {
                return {
                    success: false,
                    operation: 'lock-feature',
                    error: 'Feature is locked by another user',
                    lockedBy: existingLock.userName
                };
            }
        }

        const user = session.participants.find(p => p.userId === userId);

        const lock = {
            featureId,
            userId,
            userName: user.userName,
            lockedAt: Date.now()
        };

        session.locks.set(featureId, lock);

        // Notify other participants
        await this.notifyParticipants(session, {
            type: 'feature-locked',
            featureId,
            lockedBy: user.userName
        }, [userId]);  // Exclude current user

        return {
            success: true,
            operation: 'lock-feature',
            lock
        };
    }

    /**
     * Unlock feature
     */
    async unlockFeature(sessionId, userId, featureId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const lock = session.locks.get(featureId);
        if (!lock || lock.userId !== userId) {
            return {
                success: false,
                operation: 'unlock-feature',
                error: 'You do not own this lock'
            };
        }

        session.locks.delete(featureId);

        // Notify participants
        await this.notifyParticipants(session, {
            type: 'feature-unlocked',
            featureId
        });

        return {
            success: true,
            operation: 'unlock-feature'
        };
    }

    /**
     * Track model change
     */
    async trackChange(sessionId, userId, changeData) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const user = session.participants.find(p => p.userId === userId);

        const change = {
            changeId: `change_${Date.now()}`,
            userId,
            userName: user.userName,
            type: changeData.type,  // 'feature-added', 'feature-modified', 'feature-deleted', 'parameter-changed'
            description: changeData.description,
            before: changeData.before || null,
            after: changeData.after || null,
            timestamp: Date.now()
        };

        session.changes.push(change);

        // Log activity
        this.logActivity(session, {
            type: 'model-changed',
            userId,
            userName: user.userName,
            changeType: change.type,
            description: change.description,
            timestamp: Date.now()
        });

        // Notify participants
        await this.notifyParticipants(session, {
            type: 'model-changed',
            change
        }, [userId]);

        return {
            success: true,
            operation: 'track-change',
            change
        };
    }

    /**
     * Get activity feed
     */
    async getActivityFeed(sessionId, options = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const {
            limit = 50,
            offset = 0,
            types = null,  // Filter by activity types
            userId = null  // Filter by user
        } = options;

        let activities = this.activityLog.filter(a => a.sessionId === sessionId);

        // Apply filters
        if (types) {
            activities = activities.filter(a => types.includes(a.type));
        }

        if (userId) {
            activities = activities.filter(a => a.userId === userId);
        }

        // Sort by timestamp (newest first)
        activities.sort((a, b) => b.timestamp - a.timestamp);

        // Pagination
        const paginatedActivities = activities.slice(offset, offset + limit);

        return {
            success: true,
            operation: 'get-activity-feed',
            activities: paginatedActivities,
            total: activities.length,
            limit,
            offset
        };
    }

    /**
     * Get session summary
     */
    async getSessionSummary(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const activeUsers = session.participants.filter(p => {
            const presence = session.presence.get(p.userId);
            if (!presence) return false;

            const inactiveThreshold = 5 * 60 * 1000;  // 5 minutes
            return (Date.now() - presence.lastActivity) < inactiveThreshold;
        });

        const unresolvedComments = session.comments.filter(c => !c.resolved);

        return {
            success: true,
            operation: 'get-session-summary',
            summary: {
                sessionId,
                modelName: session.modelName,
                participants: session.participants.length,
                activeUsers: activeUsers.length,
                comments: session.comments.length,
                unresolvedComments: unresolvedComments.length,
                annotations: session.annotations.length,
                changes: session.changes.length,
                activeLocks: session.locks.size,
                duration: Date.now() - session.createdAt
            }
        };
    }

    // ========== Helper Methods ==========

    assignUserColor(index) {
        const colors = [
            '#FF6B6B',  // Red
            '#4ECDC4',  // Teal
            '#45B7D1',  // Blue
            '#FFA07A',  // Orange
            '#98D8C8',  // Green
            '#F7DC6F',  // Yellow
            '#BB8FCE',  // Purple
            '#85C1E2'   // Light Blue
        ];

        return colors[index % colors.length];
    }

    logActivity(session, activity) {
        this.activityLog.push({
            sessionId: session.sessionId,
            ...activity
        });
    }

    async notifyParticipants(session, notification, excludeUsers = []) {
        // In real implementation, this would use WebSocket/SSE to push notifications
        console.log(`    📢 Notifying ${session.participants.length - excludeUsers.length} participant(s): ${notification.type}`);

        // Simplified - just log the notification
        // Real implementation would broadcast via WebSocket
    }

    async broadcastPresence(session, userId, presence) {
        // In real implementation, this would broadcast presence via WebSocket
        // For now, just update the presence map
    }
}

module.exports = new CollaborationService();
