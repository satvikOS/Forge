/**
 * Revision Control Service
 * Version history, branching, merging, diff visualization
 * Change tracking, rollback, compare revisions
 * Integration with collaboration and lifecycle management
 */

class RevisionControlService {
    constructor() {
        this.revisions = new Map();
        this.branches = new Map();
        this.models = new Map();
    }

    /**
     * Create initial revision for model
     */
    async createInitialRevision(spec) {
        const {
            modelId,
            modelName,
            modelData,
            author,
            description = 'Initial version',
            metadata = {}
        } = spec;

        console.log(`📝 Revision Control: Creating initial revision for "${modelName}"...`);

        const revisionId = `rev_${Date.now()}_1`;

        const revision = {
            revisionId,
            modelId,
            modelName,
            version: '1.0',
            revisionNumber: 1,
            author,
            description,
            modelData,
            snapshot: this.createSnapshot(modelData),
            changes: [],
            parentRevision: null,
            branchName: 'main',
            tags: [],
            metadata: {
                ...metadata,
                fileSize: this.calculateSize(modelData),
                featureCount: this.countFeatures(modelData)
            },
            createdAt: Date.now()
        };

        // Initialize model tracking
        this.models.set(modelId, {
            modelId,
            modelName,
            currentRevision: revisionId,
            headRevision: revisionId,
            revisions: [revisionId],
            branches: ['main']
        });

        // Initialize main branch
        this.branches.set('main', {
            branchName: 'main',
            modelId,
            headRevision: revisionId,
            baseRevision: revisionId,
            createdBy: author,
            createdAt: Date.now()
        });

        this.revisions.set(revisionId, revision);

        console.log(`  ✅ Revision 1.0 created`);

        return {
            success: true,
            operation: 'create-initial-revision',
            revision
        };
    }

    /**
     * Save new revision
     */
    async saveRevision(spec) {
        const {
            modelId,
            modelData,
            author,
            description,
            branchName = 'main',
            tags = []
        } = spec;

        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        const parentRevision = this.revisions.get(model.currentRevision);

        console.log(`💾 Saving new revision for "${model.modelName}"...`);

        // Calculate changes from parent
        const changes = this.calculateChanges(parentRevision.modelData, modelData);

        const revisionNumber = model.revisions.length + 1;
        const revisionId = `rev_${Date.now()}_${revisionNumber}`;

        const revision = {
            revisionId,
            modelId,
            modelName: model.modelName,
            version: this.incrementVersion(parentRevision.version, changes.severity),
            revisionNumber,
            author,
            description,
            modelData,
            snapshot: this.createSnapshot(modelData),
            changes,
            parentRevision: parentRevision.revisionId,
            branchName,
            tags,
            metadata: {
                fileSize: this.calculateSize(modelData),
                featureCount: this.countFeatures(modelData),
                changedFeatures: changes.modified.length + changes.added.length + changes.deleted.length
            },
            createdAt: Date.now()
        };

        this.revisions.set(revisionId, revision);
        model.revisions.push(revisionId);
        model.currentRevision = revisionId;

        // Update branch head
        const branch = this.branches.get(branchName);
        if (branch) {
            branch.headRevision = revisionId;
        }

        console.log(`  ✅ Revision ${revision.version} saved (${changes.modified.length} modified, ${changes.added.length} added, ${changes.deleted.length} deleted)`);

        return {
            success: true,
            operation: 'save-revision',
            revision,
            changes: {
                modified: changes.modified.length,
                added: changes.added.length,
                deleted: changes.deleted.length
            }
        };
    }

    /**
     * Create branch from revision
     */
    async createBranch(spec) {
        const {
            modelId,
            branchName,
            baseRevisionId = null,  // If null, use current revision
            author,
            description = ''
        } = spec;

        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        if (this.branches.has(branchName)) {
            throw new Error(`Branch "${branchName}" already exists`);
        }

        const baseRevision = baseRevisionId || model.currentRevision;

        console.log(`🌿 Creating branch "${branchName}" from revision ${this.revisions.get(baseRevision).version}...`);

        const branch = {
            branchName,
            modelId,
            headRevision: baseRevision,
            baseRevision,
            description,
            createdBy: author,
            createdAt: Date.now(),
            status: 'active'
        };

        this.branches.set(branchName, branch);
        model.branches.push(branchName);

        console.log(`  ✅ Branch "${branchName}" created`);

        return {
            success: true,
            operation: 'create-branch',
            branch
        };
    }

    /**
     * Merge branch into target
     */
    async mergeBranch(spec) {
        const {
            modelId,
            sourceBranch,
            targetBranch,
            author,
            mergeStrategy = 'auto',  // 'auto', 'manual', 'accept-source', 'accept-target'
            description = ''
        } = spec;

        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        const source = this.branches.get(sourceBranch);
        const target = this.branches.get(targetBranch);

        if (!source || !target) {
            throw new Error('Source or target branch not found');
        }

        console.log(`🔀 Merging "${sourceBranch}" into "${targetBranch}"...`);

        const sourceRevision = this.revisions.get(source.headRevision);
        const targetRevision = this.revisions.get(target.headRevision);

        // Detect conflicts
        const conflicts = this.detectConflicts(sourceRevision, targetRevision);

        if (conflicts.length > 0 && mergeStrategy === 'auto') {
            console.log(`  ⚠️ ${conflicts.length} conflicts detected - requires manual resolution`);
            return {
                success: false,
                operation: 'merge-branch',
                error: 'Conflicts detected',
                conflicts,
                requiresManualResolution: true
            };
        }

        // Perform merge
        const mergedData = this.performMerge(
            sourceRevision.modelData,
            targetRevision.modelData,
            conflicts,
            mergeStrategy
        );

        // Create merge revision
        const mergeRevision = await this.saveRevision({
            modelId,
            modelData: mergedData,
            author,
            description: description || `Merge ${sourceBranch} into ${targetBranch}`,
            branchName: targetBranch,
            tags: ['merge']
        });

        console.log(`  ✅ Merge completed - ${conflicts.length} conflicts resolved`);

        return {
            success: true,
            operation: 'merge-branch',
            mergeRevision: mergeRevision.revision,
            conflicts: conflicts.length,
            strategy: mergeStrategy
        };
    }

    /**
     * Compare two revisions
     */
    async compareRevisions(revision1Id, revision2Id) {
        const rev1 = this.revisions.get(revision1Id);
        const rev2 = this.revisions.get(revision2Id);

        if (!rev1 || !rev2) {
            throw new Error('Revision not found');
        }

        console.log(`🔍 Comparing revisions ${rev1.version} and ${rev2.version}...`);

        const diff = this.calculateChanges(rev1.modelData, rev2.modelData);

        const comparison = {
            revision1: {
                id: rev1.revisionId,
                version: rev1.version,
                author: rev1.author,
                date: rev1.createdAt
            },
            revision2: {
                id: rev2.revisionId,
                version: rev2.version,
                author: rev2.author,
                date: rev2.createdAt
            },
            diff,
            summary: {
                totalChanges: diff.modified.length + diff.added.length + diff.deleted.length,
                modified: diff.modified.length,
                added: diff.added.length,
                deleted: diff.deleted.length
            }
        };

        console.log(`  ✅ ${comparison.summary.totalChanges} differences found`);

        return {
            success: true,
            operation: 'compare-revisions',
            comparison
        };
    }

    /**
     * Rollback to previous revision
     */
    async rollback(modelId, targetRevisionId, author) {
        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        const targetRevision = this.revisions.get(targetRevisionId);
        if (!targetRevision) {
            throw new Error(`Revision ${targetRevisionId} not found`);
        }

        console.log(`⏪ Rolling back to revision ${targetRevision.version}...`);

        // Create new revision with old data
        const rollbackRevision = await this.saveRevision({
            modelId,
            modelData: targetRevision.modelData,
            author,
            description: `Rollback to revision ${targetRevision.version}`,
            tags: ['rollback']
        });

        console.log(`  ✅ Rolled back to revision ${targetRevision.version}`);

        return {
            success: true,
            operation: 'rollback',
            rollbackRevision: rollbackRevision.revision,
            targetRevision: targetRevision.version
        };
    }

    /**
     * Get revision history
     */
    async getHistory(modelId, options = {}) {
        const model = this.models.get(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        const {
            branchName = null,
            limit = 50,
            offset = 0,
            author = null
        } = options;

        let revisions = model.revisions.map(id => this.revisions.get(id));

        // Filter by branch
        if (branchName) {
            revisions = revisions.filter(r => r.branchName === branchName);
        }

        // Filter by author
        if (author) {
            revisions = revisions.filter(r => r.author.userId === author);
        }

        // Sort by date (newest first)
        revisions.sort((a, b) => b.createdAt - a.createdAt);

        // Pagination
        const paginatedRevisions = revisions.slice(offset, offset + limit);

        return {
            success: true,
            operation: 'get-history',
            history: paginatedRevisions.map(r => ({
                revisionId: r.revisionId,
                version: r.version,
                author: r.author,
                description: r.description,
                branchName: r.branchName,
                tags: r.tags,
                changes: r.changes.modified?.length + r.changes.added?.length + r.changes.deleted?.length || 0,
                createdAt: r.createdAt
            })),
            total: revisions.length,
            limit,
            offset
        };
    }

    /**
     * Tag revision
     */
    async tagRevision(revisionId, tag) {
        const revision = this.revisions.get(revisionId);
        if (!revision) {
            throw new Error(`Revision ${revisionId} not found`);
        }

        if (!revision.tags.includes(tag)) {
            revision.tags.push(tag);
        }

        console.log(`🏷️ Tagged revision ${revision.version} with "${tag}"`);

        return {
            success: true,
            operation: 'tag-revision',
            revision: {
                id: revision.revisionId,
                version: revision.version,
                tags: revision.tags
            }
        };
    }

    // ========== Helper Methods ==========

    calculateChanges(oldData, newData) {
        // Simplified change detection
        const changes = {
            modified: [],
            added: [],
            deleted: [],
            severity: 'minor'  // 'patch', 'minor', 'major'
        };

        const oldFeatures = oldData.features || [];
        const newFeatures = newData.features || [];

        // Detect added features
        newFeatures.forEach(feature => {
            const existsInOld = oldFeatures.some(f => f.id === feature.id);
            if (!existsInOld) {
                changes.added.push({
                    type: 'feature',
                    id: feature.id,
                    name: feature.name || feature.type
                });
            }
        });

        // Detect deleted features
        oldFeatures.forEach(feature => {
            const existsInNew = newFeatures.some(f => f.id === feature.id);
            if (!existsInNew) {
                changes.deleted.push({
                    type: 'feature',
                    id: feature.id,
                    name: feature.name || feature.type
                });
            }
        });

        // Detect modified features
        oldFeatures.forEach(oldFeature => {
            const newFeature = newFeatures.find(f => f.id === oldFeature.id);
            if (newFeature && JSON.stringify(oldFeature) !== JSON.stringify(newFeature)) {
                changes.modified.push({
                    type: 'feature',
                    id: oldFeature.id,
                    name: oldFeature.name || oldFeature.type,
                    changes: this.getFeatureChanges(oldFeature, newFeature)
                });
            }
        });

        // Determine severity
        if (changes.deleted.length > 0) {
            changes.severity = 'major';
        } else if (changes.added.length > 0) {
            changes.severity = 'minor';
        } else if (changes.modified.length > 0) {
            changes.severity = 'patch';
        }

        return changes;
    }

    getFeatureChanges(oldFeature, newFeature) {
        const changes = [];

        // Compare parameters
        if (oldFeature.parameters && newFeature.parameters) {
            Object.keys(newFeature.parameters).forEach(key => {
                if (oldFeature.parameters[key] !== newFeature.parameters[key]) {
                    changes.push({
                        parameter: key,
                        oldValue: oldFeature.parameters[key],
                        newValue: newFeature.parameters[key]
                    });
                }
            });
        }

        return changes;
    }

    detectConflicts(sourceRevision, targetRevision) {
        const conflicts = [];

        const sourceFeatures = sourceRevision.modelData.features || [];
        const targetFeatures = targetRevision.modelData.features || [];

        // Detect conflicting modifications
        sourceFeatures.forEach(sourceFeature => {
            const targetFeature = targetFeatures.find(f => f.id === sourceFeature.id);
            if (targetFeature) {
                const sourceChanged = JSON.stringify(sourceFeature) !== JSON.stringify(targetFeature);

                if (sourceChanged) {
                    conflicts.push({
                        type: 'modification',
                        featureId: sourceFeature.id,
                        featureName: sourceFeature.name || sourceFeature.type,
                        sourceVersion: sourceRevision.version,
                        targetVersion: targetRevision.version
                    });
                }
            }
        });

        return conflicts;
    }

    performMerge(sourceData, targetData, conflicts, strategy) {
        // Simplified merge
        let mergedData = { ...targetData };

        if (strategy === 'accept-source') {
            mergedData = { ...sourceData };
        } else if (strategy === 'accept-target') {
            mergedData = { ...targetData };
        } else if (strategy === 'auto') {
            // Smart merge - combine non-conflicting changes
            mergedData.features = [...(targetData.features || [])];

            const sourceFeatures = sourceData.features || [];
            sourceFeatures.forEach(sourceFeature => {
                const existsInTarget = mergedData.features.some(f => f.id === sourceFeature.id);
                if (!existsInTarget) {
                    mergedData.features.push(sourceFeature);
                }
            });
        }

        return mergedData;
    }

    incrementVersion(currentVersion, severity) {
        const parts = currentVersion.split('.').map(Number);

        if (severity === 'major') {
            parts[0]++;
            parts[1] = 0;
        } else if (severity === 'minor') {
            parts[1]++;
        } else {
            // Patch - just increment revision number, no version change
        }

        return parts.join('.');
    }

    createSnapshot(modelData) {
        // Create lightweight snapshot for quick diff
        return {
            featureCount: this.countFeatures(modelData),
            featureIds: (modelData.features || []).map(f => f.id),
            checksum: this.calculateChecksum(modelData)
        };
    }

    countFeatures(modelData) {
        return (modelData.features || []).length;
    }

    calculateSize(modelData) {
        return JSON.stringify(modelData).length;
    }

    calculateChecksum(modelData) {
        // Simplified checksum
        return JSON.stringify(modelData).length.toString(16);
    }
}

module.exports = new RevisionControlService();
