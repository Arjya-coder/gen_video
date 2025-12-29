const { v4: uuidv4 } = require('uuid');

class InMemoryQueue {
    constructor() {
        this.jobs = new Map();
        this.queue = [];
    }

    createJob(data) {
        const jobId = uuidv4();
        const job = {
            id: jobId,
            topic: data.topic || data.prompt,
            duration_seconds: data.duration_seconds,
            tone: data.tone,
            dry_run: data.dry_run === true, // Only true if explicitly set to true; defaults to false
            status: 'QUEUED',
            progress: 0,
            eta_seconds: 0,
            created_at: new Date(),
        };
        this.jobs.set(jobId, job);
        this.enqueue(jobId);
        return job;
    }

    enqueue(jobId) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = 'QUEUED';
            this.queue.push(jobId);
            console.log(`[Queue] Job ${jobId} enqueued.`);
        }
    }

    getNextJob() {
        const jobId = this.queue.shift();
        return jobId ? this.jobs.get(jobId) : null;
    }

    updateJobStatus(jobId, status, result = null, progress = null, eta = null, message = null) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = status;
            if (result) job.result = result;
            if (progress !== null) job.progress = progress;
            if (eta !== null) job.eta_seconds = eta;
            if (message !== null) job.message = message;
            console.log(`[Queue] Job ${jobId} updated to ${status} (${job.progress}%)${message ? ' - ' + message : ''}.`);
        }
    }

    getJob(jobId) {
        return this.jobs.get(jobId);
    }
}

module.exports = new InMemoryQueue();
