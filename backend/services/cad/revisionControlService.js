/**
 * Revision Control & Approvals Service
 * Revision tracking, change descriptions, electronic approvals, audit trail
 */

class RevisionControlService {
    constructor() {
        this.revisionLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P'];
        this.lifecycleStates = this._initializeLifecycleStates();
    }

    /**
     * Initialize lifecycle states
     */
    _initializeLifecycleStates() {
        return {
            'in_progress': { label: 'In Progress', color: '#FFA500', editable: true },
            'review': { label: 'Under Review', color: '#0000FF', editable: false },
            'approved': { label: 'Approved', color: '#00FF00', editable: false },
            'released': { label: 'Released', color: '#008000', editable: false },
            'obsolete': { label: 'Obsolete', color: '#808080', editable: false }
        };
    }

    /**
     * Create new revision
     */
    async createRevision(modelData, changes, options = {}) {
        const {
            author = 'Unknown',
            description = '',
            significant = true
        } = options;

        console.log(`📝 Creating new revision for ${modelData.name}...`);

        const currentRevision = modelData.revision || 'A';
        const newRevision = significant ? this._getNextRevision(currentRevision) : currentRevision;

        const revision = {
            id: `rev_${Date.now()}`,
            revisionLabel: newRevision,
            previousRevision: currentRevision,
            timestamp: new Date().toISOString(),
            author,
            description,
            changes: changes.map(change => ({
                type: change.type,
                feature: change.feature,
                oldValue: change.oldValue,
                newValue: change.newValue,
                reason: change.reason || ''
            })),
            significant,
            approvals: [],
            status: 'pending_approval'
        };

        // Archive previous version
        if (!modelData.revisionHistory) {
            modelData.revisionHistory = [];
        }

        modelData.revisionHistory.push({
            revision: currentRevision,
            snapshot: JSON.parse(JSON.stringify(modelData)), // Deep copy
            archivedAt: new Date().toISOString()
        });

        // Update model revision
        modelData.revision = newRevision;
        modelData.currentRevision = revision;

        console.log(`✅ Revision ${newRevision} created from ${currentRevision}`);

        return revision;
    }

    /**
     * Request approval for revision
     */
    async requestApproval(revision, approvers) {
        console.log(`✉️ Requesting approval from ${approvers.length} approvers...`);

        const approvalRequest = {
            revisionId: revision.id,
            requestedAt: new Date().toISOString(),
            approvers: approvers.map(approver => ({
                name: approver.name,
                role: approver.role,
                email: approver.email,
                status: 'pending',
                approvedAt: null,
                signature: null,
                comments: ''
            })),
            status: 'pending'
        };

        revision.approvalRequest = approvalRequest;

        console.log(`✅ Approval request sent to: ${approvers.map(a => a.name).join(', ')}`);

        return approvalRequest;
    }

    /**
     * Approve or reject revision
     */
    async processApproval(revision, approverName, decision, options = {}) {
        const {
            comments = '',
            digitalSignature = null
        } = options;

        console.log(`✔️ Processing approval from ${approverName}: ${decision}...`);

        const approver = revision.approvalRequest.approvers.find(a => a.name === approverName);

        if (!approver) {
            throw new Error(`Approver ${approverName} not found in approval list`);
        }

        approver.status = decision; // 'approved' or 'rejected'
        approver.approvedAt = new Date().toISOString();
        approver.comments = comments;
        approver.signature = digitalSignature;

        // Update overall approval status
        const allApproved = revision.approvalRequest.approvers.every(a => a.status === 'approved');
        const anyRejected = revision.approvalRequest.approvers.some(a => a.status === 'rejected');

        if (allApproved) {
            revision.approvalRequest.status = 'approved';
            revision.status = 'approved';
            console.log(`✅ Revision fully approved`);
        } else if (anyRejected) {
            revision.approvalRequest.status = 'rejected';
            revision.status = 'rejected';
            console.log(`❌ Revision rejected`);
        }

        // Add to audit trail
        this._addAuditEntry(revision, {
            action: decision,
            actor: approverName,
            timestamp: new Date().toISOString(),
            details: comments
        });

        return {
            status: revision.status,
            approver: approverName,
            decision,
            comments
        };
    }

    /**
     * Release model (lock for editing)
     */
    async releaseModel(modelData, releaseOptions = {}) {
        const {
            releaseNotes = '',
            effectiveDate = new Date().toISOString()
        } = releaseOptions;

        console.log(`🔒 Releasing model ${modelData.name} Rev ${modelData.revision}...`);

        if (modelData.currentRevision?.status !== 'approved') {
            throw new Error('Cannot release model without approval');
        }

        modelData.lifecycleState = 'released';
        modelData.releasedAt = effectiveDate;
        modelData.releaseNotes = releaseNotes;
        modelData.locked = true;

        this._addAuditEntry(modelData.currentRevision, {
            action: 'released',
            actor: 'System',
            timestamp: new Date().toISOString(),
            details: `Model released as Rev ${modelData.revision}`
        });

        console.log(`✅ Model released and locked`);

        return {
            revision: modelData.revision,
            state: 'released',
            releasedAt: effectiveDate,
            locked: true
        };
    }

    /**
     * Get audit trail for model
     */
    getAuditTrail(modelData) {
        console.log(`📊 Retrieving audit trail for ${modelData.name}...`);

        const trail = [];

        // Collect from all revisions
        modelData.revisionHistory?.forEach(rev => {
            if (rev.snapshot.currentRevision?.auditTrail) {
                trail.push(...rev.snapshot.currentRevision.auditTrail);
            }
        });

        // Add current revision audit trail
        if (modelData.currentRevision?.auditTrail) {
            trail.push(...modelData.currentRevision.auditTrail);
        }

        // Sort by timestamp
        trail.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        console.log(`✅ Audit trail retrieved: ${trail.length} entries`);

        return trail;
    }

    /**
     * Rollback to previous revision
     */
    async rollbackToRevision(modelData, targetRevision) {
        console.log(`⏪ Rolling back to revision ${targetRevision}...`);

        const revisionSnapshot = modelData.revisionHistory?.find(r => r.revision === targetRevision);

        if (!revisionSnapshot) {
            throw new Error(`Revision ${targetRevision} not found in history`);
        }

        // Create rollback revision
        const rollbackChanges = [{
            type: 'rollback',
            feature: 'entire_model',
            oldValue: modelData.revision,
            newValue: targetRevision,
            reason: `Rolled back from ${modelData.revision} to ${targetRevision}`
        }];

        const newRevision = await this.createRevision(modelData, rollbackChanges, {
            author: 'System',
            description: `Rollback to revision ${targetRevision}`,
            significant: true
        });

        // Restore snapshot data
        Object.assign(modelData, revisionSnapshot.snapshot);
        modelData.revision = this._getNextRevision(targetRevision);
        modelData.rolledBackFrom = rollbackChanges[0].oldValue;

        this._addAuditEntry(newRevision, {
            action: 'rollback',
            actor: 'System',
            timestamp: new Date().toISOString(),
            details: `Rolled back from ${rollbackChanges[0].oldValue} to ${targetRevision}`
        });

        console.log(`✅ Rolled back to revision ${targetRevision}, now at ${modelData.revision}`);

        return modelData;
    }

    /**
     * Change lifecycle state
     */
    async changeLifecycleState(modelData, newState) {
        console.log(`🔄 Changing lifecycle state to ${newState}...`);

        const validStates = Object.keys(this.lifecycleStates);

        if (!validStates.includes(newState)) {
            throw new Error(`Invalid lifecycle state: ${newState}`);
        }

        const oldState = modelData.lifecycleState || 'in_progress';
        modelData.lifecycleState = newState;

        // Apply state-specific rules
        if (newState === 'released') {
            modelData.locked = true;
        } else if (newState === 'in_progress') {
            modelData.locked = false;
        }

        if (modelData.currentRevision) {
            this._addAuditEntry(modelData.currentRevision, {
                action: 'state_change',
                actor: 'User',
                timestamp: new Date().toISOString(),
                details: `Changed from ${oldState} to ${newState}`
            });
        }

        console.log(`✅ Lifecycle state changed: ${oldState} → ${newState}`);

        return {
            previousState: oldState,
            newState,
            locked: modelData.locked
        };
    }

    // Helper methods

    _getNextRevision(currentRevision) {
        const currentIndex = this.revisionLabels.indexOf(currentRevision);

        if (currentIndex === -1 || currentIndex >= this.revisionLabels.length - 1) {
            return 'A1'; // Start numeric after Z
        }

        return this.revisionLabels[currentIndex + 1];
    }

    _addAuditEntry(revision, entry) {
        if (!revision.auditTrail) {
            revision.auditTrail = [];
        }

        revision.auditTrail.push({
            id: `audit_${Date.now()}`,
            ...entry
        });
    }
}

module.exports = new RevisionControlService();
