/**
 * ArchDisc — PDM / Version Control
 * Tracks design revisions, change history, approval workflows.
 * Local-first (IndexedDB) with cloud sync capability.
 */

let _revisionCounter = 0;

export default class VersionControl {
  constructor(projectName = 'Untitled') {
    this.projectName = projectName;
    this.revisions = [];
    this.currentRevision = null;
    this.branches = [{ name: 'main', headRevision: null }];
    this.currentBranch = 'main';
    this.tags = new Map();
    this.approvals = [];
  }

  /**
   * Save a new revision (snapshot of the feature tree).
   */
  commit(featureTreeJSON, message, author = 'ArchDisc User') {
    const rev = {
      id: ++_revisionCounter,
      timestamp: new Date().toISOString(),
      message,
      author,
      branch: this.currentBranch,
      parent: this.currentRevision?.id || null,
      data: JSON.parse(JSON.stringify(featureTreeJSON)),
      hash: this._hash(JSON.stringify(featureTreeJSON)),
      stats: {
        featureCount: featureTreeJSON.features?.length || 0,
      },
    };

    this.revisions.push(rev);
    this.currentRevision = rev;

    // Update branch head
    const branch = this.branches.find(b => b.name === this.currentBranch);
    if (branch) branch.headRevision = rev.id;

    return rev;
  }

  /**
   * Restore a specific revision.
   */
  checkout(revisionId) {
    const rev = this.revisions.find(r => r.id === revisionId);
    if (!rev) throw new Error(`Revision ${revisionId} not found`);
    this.currentRevision = rev;
    return rev.data;
  }

  /**
   * Create a new branch from current revision.
   */
  createBranch(name) {
    if (this.branches.find(b => b.name === name)) throw new Error(`Branch ${name} exists`);
    this.branches.push({ name, headRevision: this.currentRevision?.id || null });
    this.currentBranch = name;
    return name;
  }

  /**
   * Switch to a branch.
   */
  switchBranch(name) {
    const branch = this.branches.find(b => b.name === name);
    if (!branch) throw new Error(`Branch ${name} not found`);
    this.currentBranch = name;
    if (branch.headRevision) {
      return this.checkout(branch.headRevision);
    }
    return null;
  }

  /**
   * Tag a revision (e.g., 'v1.0', 'Released', 'For Review').
   */
  tag(revisionId, tagName) {
    this.tags.set(tagName, revisionId);
  }

  /**
   * Submit for approval.
   */
  submitForApproval(revisionId, reviewers = []) {
    const approval = {
      id: this.approvals.length + 1,
      revisionId,
      submittedAt: new Date().toISOString(),
      status: 'pending', // pending, approved, rejected, changes_requested
      reviewers: reviewers.map(r => ({ name: r, status: 'pending', comments: '' })),
    };
    this.approvals.push(approval);
    return approval;
  }

  /**
   * Get revision history.
   */
  log(limit = 50) {
    return this.revisions
      .slice(-limit)
      .reverse()
      .map(r => ({
        id: r.id,
        hash: r.hash.substring(0, 8),
        message: r.message,
        author: r.author,
        timestamp: r.timestamp,
        branch: r.branch,
        featureCount: r.stats.featureCount,
      }));
  }

  /**
   * Diff between two revisions.
   */
  diff(revA, revB) {
    const a = this.revisions.find(r => r.id === revA);
    const b = this.revisions.find(r => r.id === revB);
    if (!a || !b) return null;

    const featA = new Set((a.data.features || []).map(f => `${f.type}_${f.id}`));
    const featB = new Set((b.data.features || []).map(f => `${f.type}_${f.id}`));

    const added = [...featB].filter(f => !featA.has(f));
    const removed = [...featA].filter(f => !featB.has(f));
    const common = [...featA].filter(f => featB.has(f));

    return { added, removed, unchanged: common.length, revA, revB };
  }

  /**
   * Export project as a zip-ready structure.
   */
  exportProject() {
    return {
      projectName: this.projectName,
      exportedAt: new Date().toISOString(),
      currentBranch: this.currentBranch,
      currentRevision: this.currentRevision?.id,
      revisions: this.revisions,
      branches: this.branches,
      tags: Object.fromEntries(this.tags),
      approvals: this.approvals,
    };
  }

  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}
