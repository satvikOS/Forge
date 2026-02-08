const fs = require('fs');
const path = require('path');

/**
 * Project Management Service
 * Handles project creation, persistence, auto-save, and library.
 * Projects persist across page refreshes via filesystem storage.
 */

const PROJECTS_DIR = path.join(__dirname, '..', 'data', 'projects');

// Ensure projects directory exists
function ensureProjectsDir() {
    if (!fs.existsSync(PROJECTS_DIR)) {
        fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    }
}

class ProjectManagementService {
    constructor() {
        ensureProjectsDir();
        this.activeProjects = new Map(); // In-memory cache
    }

    /**
     * Create a new project automatically from first prompt
     */
    createProject(prompt, userId = 'default') {
        const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();

        const project = {
            id,
            userId,
            name: this._generateProjectName(prompt),
            description: prompt,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            chatHistory: [],
            components: [],
            models: [],
            designSpecs: {},
            clarificationState: null,
            metadata: {
                promptCount: 1,
                modelCount: 0,
                lastPrompt: prompt,
            },
        };

        this._saveProject(project);
        this.activeProjects.set(id, project);
        return project;
    }

    /**
     * Get a project by ID
     */
    getProject(projectId) {
        // Check cache first
        if (this.activeProjects.has(projectId)) {
            return this.activeProjects.get(projectId);
        }

        // Load from disk
        const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                this.activeProjects.set(projectId, data);
                return data;
            } catch (e) {
                console.error(`Failed to load project ${projectId}:`, e.message);
                return null;
            }
        }
        return null;
    }

    /**
     * Update a project (auto-save)
     */
    updateProject(projectId, updates) {
        const project = this.getProject(projectId);
        if (!project) return null;

        const updated = {
            ...project,
            ...updates,
            updatedAt: new Date().toISOString(),
        };

        this._saveProject(updated);
        this.activeProjects.set(projectId, updated);
        return updated;
    }

    /**
     * Add a chat message to project history
     */
    addChatMessage(projectId, role, content, metadata = {}) {
        const project = this.getProject(projectId);
        if (!project) return null;

        project.chatHistory.push({
            role,
            content,
            timestamp: new Date().toISOString(),
            ...metadata,
        });
        project.metadata.promptCount = (project.metadata.promptCount || 0) + (role === 'user' ? 1 : 0);
        project.updatedAt = new Date().toISOString();

        this._saveProject(project);
        return project;
    }

    /**
     * Add a model to project
     */
    addModelToProject(projectId, modelRecord) {
        const project = this.getProject(projectId);
        if (!project) return null;

        project.models.push({
            id: modelRecord.id,
            name: modelRecord.name,
            designId: modelRecord.designId,
            components: modelRecord.components?.map(c => ({ id: c.id, name: c.name, type: c.type })) || [],
            material: modelRecord.material,
            massProperties: modelRecord.massProperties,
            addedAt: new Date().toISOString(),
        });
        project.metadata.modelCount = project.models.length;
        project.updatedAt = new Date().toISOString();

        this._saveProject(project);
        return project;
    }

    /**
     * Store clarification state (so user can resume after refresh)
     */
    setClarificationState(projectId, state) {
        return this.updateProject(projectId, { clarificationState: state });
    }

    /**
     * List all projects for a user (library)
     */
    listProjects(userId = 'default') {
        ensureProjectsDir();
        const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
        const projects = [];

        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, file), 'utf-8'));
                if (!userId || data.userId === userId) {
                    projects.push({
                        id: data.id,
                        name: data.name,
                        description: data.description,
                        status: data.status,
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt,
                        modelCount: data.metadata?.modelCount || 0,
                        promptCount: data.metadata?.promptCount || 0,
                    });
                }
            } catch (e) {
                // Skip corrupt files
            }
        }

        // Sort by most recently updated
        projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        return projects;
    }

    /**
     * Delete a project
     */
    deleteProject(projectId) {
        const filePath = path.join(PROJECTS_DIR, `${projectId}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        this.activeProjects.delete(projectId);
        return true;
    }

    /**
     * Get the most recent active project (for resume after refresh)
     */
    getRecentProject(userId = 'default') {
        const projects = this.listProjects(userId);
        return projects.find(p => p.status === 'active') || null;
    }

    // ─── Internal ────────────────────────────────────────────────────

    _saveProject(project) {
        ensureProjectsDir();
        const filePath = path.join(PROJECTS_DIR, `${project.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(project, null, 2));
    }

    _generateProjectName(prompt) {
        // Extract meaningful name from prompt
        const cleaned = prompt.replace(/[^a-zA-Z0-9\s]/g, '').trim();
        const words = cleaned.split(/\s+/).slice(0, 5);
        if (words.length === 0) return 'Untitled Project';

        // Capitalize first letter of each word
        return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
}

module.exports = new ProjectManagementService();
