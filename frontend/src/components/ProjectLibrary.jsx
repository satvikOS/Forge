import React, { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Plus, Clock, Box, MessageSquare, Trash2, ChevronRight } from 'lucide-react';
import './ProjectLibrary.css';

const API_BASE = '/api/projects';

/**
 * ProjectLibrary - Shows list of auto-saved projects
 * Allows resuming previous projects after page refresh
 */
function ProjectLibrary({ onSelectProject, onNewProject, activeProjectId }) {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(false);

    const fetchProjects = useCallback(async () => {
        try {
            const res = await fetch(API_BASE);
            const data = await res.json();
            if (data.success) {
                setProjects(data.projects || []);
            }
        } catch (e) {
            console.warn('Failed to load projects:', e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    const handleDelete = async (e, projectId) => {
        e.stopPropagation();
        try {
            await fetch(`${API_BASE}/${projectId}`, { method: 'DELETE' });
            setProjects(prev => prev.filter(p => p.id !== projectId));
        } catch (e) {
            console.error('Failed to delete project:', e);
        }
    };

    const formatTime = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now - d;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    };

    if (!isOpen) {
        return (
            <button className="project-library-toggle" onClick={() => setIsOpen(true)} title="Project Library">
                <FolderOpen size={14} />
                <span>Projects</span>
                {projects.length > 0 && <span className="project-count">{projects.length}</span>}
            </button>
        );
    }

    return (
        <div className="project-library">
            <div className="project-library-header">
                <FolderOpen size={14} />
                <span>Project Library</span>
                <button className="close-library" onClick={() => setIsOpen(false)}>&times;</button>
            </div>

            <button className="new-project-btn" onClick={onNewProject}>
                <Plus size={14} />
                New Project
            </button>

            <div className="project-list">
                {loading ? (
                    <div className="project-loading">Loading...</div>
                ) : projects.length === 0 ? (
                    <div className="project-empty">No projects yet. Start a conversation to create one.</div>
                ) : (
                    projects.map(p => (
                        <div
                            key={p.id}
                            className={`project-item ${p.id === activeProjectId ? 'active' : ''}`}
                            onClick={() => onSelectProject(p.id)}
                        >
                            <div className="project-item-top">
                                <span className="project-name">{p.name}</span>
                                <ChevronRight size={12} className="project-arrow" />
                            </div>
                            <div className="project-item-meta">
                                <span className="meta-item">
                                    <Clock size={10} />
                                    {formatTime(p.updatedAt)}
                                </span>
                                <span className="meta-item">
                                    <Box size={10} />
                                    {p.modelCount || 0}
                                </span>
                                <span className="meta-item">
                                    <MessageSquare size={10} />
                                    {p.promptCount || 0}
                                </span>
                                <button
                                    className="project-delete"
                                    onClick={(e) => handleDelete(e, p.id)}
                                    title="Delete project"
                                >
                                    <Trash2 size={10} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default ProjectLibrary;
