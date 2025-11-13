/**
 * Job Queue - Manages async 3D generation jobs
 * Handles job creation, status tracking, and progress updates
 */
class JobQueue {
  constructor() {
    this.jobs = new Map();
    this.maxConcurrentJobs = 5;
    this.activeJobs = 0;
    this.jobTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Create a new job
   */
  createJob(prompt, options = {}) {
    const jobId = this.generateJobId();
    const job = {
      id: jobId,
      prompt,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: null,
      error: null,
      options,
      stages: {
        analyzing: { status: 'pending', progress: 0 },
        generating: { status: 'pending', progress: 0 },
        refining: { status: 'pending', progress: 0 },
        exporting: { status: 'pending', progress: 0 },
      },
    };
    
    this.jobs.set(jobId, job);
    this.processNextJob();
    
    return jobId;
  }

  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  /**
   * Update job status
   */
  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    
    Object.assign(job, updates, { updatedAt: Date.now() });
    this.jobs.set(jobId, job);
    
    return job;
  }

  /**
   * Update job progress
   */
  updateProgress(jobId, stage, progress) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    
    if (job.stages[stage]) {
      job.stages[stage].status = 'in_progress';
      job.stages[stage].progress = progress;
    }
    
    // Calculate overall progress
    const stages = Object.values(job.stages);
    const totalProgress = stages.reduce((sum, s) => sum + (s.progress || 0), 0);
    job.progress = Math.round(totalProgress / stages.length);
    job.updatedAt = Date.now();
    
    this.jobs.set(jobId, job);
    return job;
  }

  /**
   * Complete stage
   */
  completeStage(jobId, stage) {
    const job = this.jobs.get(jobId);
    if (!job || !job.stages[stage]) return null;
    
    job.stages[stage].status = 'completed';
    job.stages[stage].progress = 100;
    job.updatedAt = Date.now();
    
    this.jobs.set(jobId, job);
    return job;
  }

  /**
   * Mark job as completed
   */
  completeJob(jobId, result) {
    const job = this.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      result,
      completedAt: Date.now(),
    });
    
    if (job) {
      this.activeJobs--;
      this.processNextJob();
    }
    
    return job;
  }

  /**
   * Mark job as failed
   */
  failJob(jobId, error) {
    const job = this.updateJob(jobId, {
      status: 'failed',
      error: error.message || 'Unknown error',
      failedAt: Date.now(),
    });
    
    if (job) {
      this.activeJobs--;
      this.processNextJob();
    }
    
    return job;
  }

  /**
   * Process next job in queue
   */
  processNextJob() {
    if (this.activeJobs >= this.maxConcurrentJobs) {
      return;
    }
    
    // Find next queued job
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'queued') {
        this.startJob(jobId);
        break;
      }
    }
  }

  /**
   * Start processing a job
   */
  startJob(jobId) {
    const job = this.updateJob(jobId, {
      status: 'processing',
      startedAt: Date.now(),
    });
    
    if (!job) return;
    
    this.activeJobs++;
    
    // Set timeout for job
    setTimeout(() => {
      const currentJob = this.getJob(jobId);
      if (currentJob && currentJob.status === 'processing') {
        this.failJob(jobId, new Error('Job timeout'));
      }
    }, this.jobTimeout);
  }

  /**
   * Cancel job
   */
  cancelJob(jobId) {
    const job = this.updateJob(jobId, {
      status: 'cancelled',
      cancelledAt: Date.now(),
    });
    
    if (job && job.status === 'processing') {
      this.activeJobs--;
      this.processNextJob();
    }
    
    return job;
  }

  /**
   * Delete job
   */
  deleteJob(jobId) {
    const job = this.jobs.get(jobId);
    if (job && job.status === 'processing') {
      this.activeJobs--;
      this.processNextJob();
    }
    
    return this.jobs.delete(jobId);
  }

  /**
   * Clean up old jobs
   */
  cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const jobsToDelete = [];
    
    for (const [jobId, job] of this.jobs.entries()) {
      if (now - job.createdAt > maxAge) {
        jobsToDelete.push(jobId);
      }
    }
    
    jobsToDelete.forEach(jobId => this.deleteJob(jobId));
    
    return jobsToDelete.length;
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const stats = {
      total: this.jobs.size,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      active: this.activeJobs,
    };
    
    for (const job of this.jobs.values()) {
      if (stats[job.status] !== undefined) {
        stats[job.status]++;
      }
    }
    
    return stats;
  }

  /**
   * List all jobs
   */
  listJobs(filter = {}) {
    const jobs = Array.from(this.jobs.values());
    
    if (filter.status) {
      return jobs.filter(job => job.status === filter.status);
    }
    
    return jobs;
  }

  /**
   * Generate unique job ID
   */
  generateJobId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return `job_${timestamp}_${random}`;
  }

  /**
   * Get job result
   */
  getJobResult(jobId) {
    const job = this.getJob(jobId);
    if (!job) return null;
    
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  }

  /**
   * Check if job is ready for download
   */
  isJobReady(jobId) {
    const job = this.getJob(jobId);
    return job && job.status === 'completed' && job.result;
  }
}

// Create singleton instance
const jobQueue = new JobQueue();

// Cleanup old jobs every hour
setInterval(() => {
  const deleted = jobQueue.cleanupOldJobs();
  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} old jobs`);
  }
}, 60 * 60 * 1000);

module.exports = jobQueue;
