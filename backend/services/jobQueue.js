/**
 * Job Queue - Manages async 3D generation jobs
 * Handles job creation, status tracking, and progress updates
 *
 * Uses DynamoDB for persistence across Lambda instances
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

// Global job storage - fallback for local dev or when DynamoDB unavailable
const globalJobs = global.jobQueueStorage || new Map();
global.jobQueueStorage = globalJobs;

class JobQueue {
  constructor() {
    this.jobs = globalJobs; // Fallback for in-memory storage
    this.maxConcurrentJobs = 5;
    this.activeJobs = 0;
    this.jobTimeout = 12 * 60 * 1000; // 12 minutes (Lambda max is 15 min)
    this.completedJobRetention = 10 * 60 * 1000; // Keep completed jobs for 10 minutes

    // Initialize DynamoDB for serverless persistence
    this.useDynamoDB = process.env.AWS_REGION && process.env.AWS_EXECUTION_ENV;
    if (this.useDynamoDB) {
      const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
      this.dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
      this.tableName = `archdisc-workflows-${process.env.STAGE || 'dev'}`;
      console.log(`✅ JobQueue using DynamoDB table: ${this.tableName}`);
    } else {
      console.log('⚠️  JobQueue using in-memory storage (local dev mode)');
    }

    // Clean up old jobs periodically
    this.startCleanupTimer();
  }

  /**
   * Create a new job
   */
  createJob(prompt, options = {}) {
    const jobId = this.generateJobId();
    const job = {
      id: jobId,
      workflowId: jobId, // DynamoDB primary key
      userId: options.userId || 'anonymous',
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

    // Store in both memory and DynamoDB
    this.jobs.set(jobId, job);

    if (this.useDynamoDB) {
      this.dynamoDB.send(new PutCommand({
        TableName: this.tableName,
        Item: job
      })).catch(err => console.error('DynamoDB PutCommand error:', err));
    }

    this.processNextJob();

    return jobId;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId) {
    // Try memory first (fast)
    let job = this.jobs.get(jobId);
    if (job) return job;

    // Try DynamoDB (for cross-instance retrieval)
    if (this.useDynamoDB) {
      try {
        const response = await this.dynamoDB.send(new GetCommand({
          TableName: this.tableName,
          Key: { workflowId: jobId }
        }));
        job = response.Item;
        if (job) {
          // Cache in memory for future requests
          this.jobs.set(jobId, job);
          return job;
        }
      } catch (err) {
        console.error('DynamoDB GetCommand error:', err);
      }
    }

    return null;
  }

  /**
   * Update job status
   */
  updateJob(jobId, updates) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    Object.assign(job, updates, { updatedAt: Date.now() });
    this.jobs.set(jobId, job);

    // Update DynamoDB asynchronously
    if (this.useDynamoDB) {
      this.dynamoDB.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { workflowId: jobId },
        UpdateExpression: 'SET #status = :status, #progress = :progress, #updatedAt = :updatedAt, #result = :result, #error = :error, #stages = :stages',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#progress': 'progress',
          '#updatedAt': 'updatedAt',
          '#result': 'result',
          '#error': 'error',
          '#stages': 'stages'
        },
        ExpressionAttributeValues: {
          ':status': job.status,
          ':progress': job.progress,
          ':updatedAt': job.updatedAt,
          ':result': job.result,
          ':error': job.error,
          ':stages': job.stages
        }
      })).catch(err => console.error('DynamoDB UpdateCommand error:', err));
    }

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

  /**
   * Start cleanup timer for old jobs (serverless-friendly)
   * Only cleans up truly old jobs, keeps completed jobs for 10 minutes
   */
  startCleanupTimer() {
    // In serverless, we don't want persistent intervals
    // Instead, clean up on each job creation
    // This method is here for compatibility but does minimal work
  }

  /**
   * Clean up old completed/failed jobs but keep recent ones
   * Called periodically to prevent memory bloat in long-running instances
   */
  cleanupCompletedJobs() {
    const now = Date.now();
    const jobsToDelete = [];
    
    for (const [jobId, job] of this.jobs.entries()) {
      // Only delete completed/failed jobs older than retention period
      if ((job.status === 'completed' || job.status === 'failed') && 
          job.updatedAt && (now - job.updatedAt > this.completedJobRetention)) {
        jobsToDelete.push(jobId);
      }
      // Delete very old jobs regardless of status (24 hours)
      else if (now - job.createdAt > 24 * 60 * 60 * 1000) {
        jobsToDelete.push(jobId);
      }
    }
    
    jobsToDelete.forEach(jobId => this.deleteJob(jobId));
    
    if (jobsToDelete.length > 0) {
      console.log(`🧹 Cleaned up ${jobsToDelete.length} old jobs`);
    }
    
    return jobsToDelete.length;
  }
}

// Create singleton instance
const jobQueue = new JobQueue();

// For serverless environments, clean up on module load (not interval)
// This runs when the module is first loaded in a new container
jobQueue.cleanupCompletedJobs();

// In traditional server environments, also clean periodically
// But make it less aggressive to not interfere with serverless
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  setInterval(() => {
    const deleted = jobQueue.cleanupOldJobs();
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} old jobs`);
    }
  }, 60 * 60 * 1000);
}

module.exports = jobQueue;
