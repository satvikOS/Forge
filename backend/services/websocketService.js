/**
 * WebSocket Service for Real-time Collaboration
 * Enables live co-editing, presence awareness, and real-time updates
 */

const WebSocket = require('ws');

class WebSocketService {
    constructor() {
        this.wss = null;
        this.rooms = new Map(); // Project rooms for collaboration
        this.users = new Map(); // Connected users
    }

    initialize(server) {
        this.wss = new WebSocket.Server({ server });

        this.wss.on('connection', (ws, req) => {
            const userId = this.extractUserId(req);
            console.log(`🔌 WebSocket connected: ${userId}`);

            // Store user connection
            this.users.set(userId, ws);

            ws.on('message', (message) => {
                this.handleMessage(userId, message);
            });

            ws.on('close', () => {
                console.log(`🔌 WebSocket disconnected: ${userId}`);
                this.users.delete(userId);
                this.removeUserFromAllRooms(userId);
            });

            // Send welcome message
            ws.send(JSON.stringify({
                type: 'connected',
                userId,
                timestamp: new Date().toISOString()
            }));
        });

        console.log('✅ WebSocket server initialized');
    }

    handleMessage(userId, message) {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'join_project':
                    this.joinProject(userId, data.projectId);
                    break;
                case 'leave_project':
                    this.leaveProject(userId, data.projectId);
                    break;
                case 'design_update':
                    this.broadcastDesignUpdate(userId, data.projectId, data.update);
                    break;
                case 'cursor_move':
                    this.broadcastCursorMove(userId, data.projectId, data.position);
                    break;
                default:
                    console.warn('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    joinProject(userId, projectId) {
        if (!this.rooms.has(projectId)) {
            this.rooms.set(projectId, new Set());
        }

        this.rooms.get(projectId).add(userId);

        // Notify other users
        this.broadcastToRoom(projectId, {
            type: 'user_joined',
            userId,
            timestamp: new Date().toISOString()
        }, userId);

        console.log(`👥 User ${userId} joined project ${projectId}`);
    }

    leaveProject(userId, projectId) {
        if (this.rooms.has(projectId)) {
            this.rooms.get(projectId).delete(userId);

            // Notify other users
            this.broadcastToRoom(projectId, {
                type: 'user_left',
                userId,
                timestamp: new Date().toISOString()
            });
        }
    }

    broadcastDesignUpdate(userId, projectId, update) {
        this.broadcastToRoom(projectId, {
            type: 'design_update',
            userId,
            update,
            timestamp: new Date().toISOString()
        }, userId);
    }

    broadcastCursorMove(userId, projectId, position) {
        this.broadcastToRoom(projectId, {
            type: 'cursor_move',
            userId,
            position,
            timestamp: new Date().toISOString()
        }, userId);
    }

    broadcastToRoom(projectId, message, excludeUserId = null) {
        const room = this.rooms.get(projectId);
        if (!room) return;

        const messageStr = JSON.stringify(message);

        room.forEach(userId => {
            if (userId !== excludeUserId) {
                const ws = this.users.get(userId);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(messageStr);
                }
            }
        });
    }

    removeUserFromAllRooms(userId) {
        this.rooms.forEach((users, projectId) => {
            if (users.has(userId)) {
                users.delete(userId);
                this.broadcastToRoom(projectId, {
                    type: 'user_left',
                    userId,
                    timestamp: new Date().toISOString()
                });
            }
        });
    }

    extractUserId(req) {
        // Extract from query params or headers
        const url = new URL(req.url, 'http://localhost');
        return url.searchParams.get('userId') || `user_${Date.now()}`;
    }
}

module.exports = new WebSocketService();
