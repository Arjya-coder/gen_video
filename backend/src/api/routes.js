const express = require('express');
const router = express.Router();
const queue = require('../queue/inMemoryQueue');
const cleanupService = require('../services/cleanupService');

router.get('/jobs', (req, res) => {
    const allJobs = Array.from(queue.jobs.values());
    res.json(allJobs);
});

router.post('/generate', (req, res) => {
    const { topic, duration_seconds, tone, dry_run } = req.body;

    if (!topic || typeof topic !== 'string' || topic.trim() === '') {
        return res.status(400).json({ error: 'Topic is required' });
    }

    if (!duration_seconds || duration_seconds < 20 || duration_seconds > 60) {
        return res.status(400).json({ error: 'Duration must be between 20 and 60 seconds' });
    }

    const validTones = ['informative', 'dramatic', 'motivational', 'neutral'];
    if (!tone || !validTones.includes(tone)) {
        return res.status(400).json({ error: `Tone must be one of: ${validTones.join(', ')}` });
    }

    const job = queue.createJob({ topic, duration_seconds, tone, dry_run });

    res.status(202).json({
        job_id: job.id,
        status: job.status
    });
});

router.get('/status/:id', (req, res) => {
    const job = queue.getJob(req.params.id);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
});

router.post('/mark/:id', (req, res) => {
    const success = cleanupService.markJob(req.params.id);
    res.json({ success });
});

router.post('/unmark/:id', (req, res) => {
    const success = cleanupService.unmarkJob(req.params.id);
    res.json({ success });
});

router.get('/is-marked/:id', (req, res) => {
    const isMarked = cleanupService.isJobMarked(req.params.id);
    res.json({ isMarked });
});

module.exports = router;
