const express = require('express');
const router = express.Router();
const projectManagement = require('../services/projectManagementService');

/**
 * Project Management Routes
 * Auto-create projects on first prompt, library, persistence
 */

/**
 * POST /api/projects
 * Create a new project from initial prompt
 */
router.post('/', (req, res) => {
    try {
        const { prompt, userId } = req.body;

        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ success: false, error: 'Prompt is required' });
        }

        const project = projectManagement.createProject(prompt.trim(), userId);

        res.json({
            success: true,
            project: {
                id: project.id,
                name: project.name,
                status: project.status,
                createdAt: project.createdAt,
            },
        });
    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/projects
 * List all projects (library)
 */
router.get('/', (req, res) => {
    try {
        const { userId } = req.query;
        const projects = projectManagement.listProjects(userId);

        res.json({ success: true, projects });
    } catch (error) {
        console.error('List projects error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/projects/recent
 * Get most recent active project (for resume after refresh)
 */
router.get('/recent', (req, res) => {
    try {
        const { userId } = req.query;
        const project = projectManagement.getRecentProject(userId);

        res.json({ success: true, project });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/projects/:id
 * Get full project details
 */
router.get('/:id', (req, res) => {
    try {
        const project = projectManagement.getProject(req.params.id);

        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        res.json({ success: true, project });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/projects/:id
 * Update project
 */
router.patch('/:id', (req, res) => {
    try {
        const updated = projectManagement.updateProject(req.params.id, req.body);

        if (!updated) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        res.json({ success: true, project: { id: updated.id, name: updated.name, updatedAt: updated.updatedAt } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/projects/:id/chat
 * Add chat message to project
 */
router.post('/:id/chat', (req, res) => {
    try {
        const { role, content, metadata } = req.body;
        const updated = projectManagement.addChatMessage(req.params.id, role, content, metadata);

        if (!updated) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        res.json({ success: true, chatLength: updated.chatHistory.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/projects/:id/models
 * Add model to project
 */
router.post('/:id/models', (req, res) => {
    try {
        const updated = projectManagement.addModelToProject(req.params.id, req.body);

        if (!updated) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        res.json({ success: true, modelCount: updated.models.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/projects/:id
 * Delete a project
 */
router.delete('/:id', (req, res) => {
    try {
        projectManagement.deleteProject(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
