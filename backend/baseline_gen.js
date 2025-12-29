const axios = require('axios');

const topics = [
    "The Psychology of Procrastination",
    "How Black Holes Work",
    "The History of the Renaissance",
    "Why Sleep is Essential",
    "The Future of Quantum Computing",
    "The Mystery of the Bermuda Triangle",
    "How to Master Public Speaking",
    "The Science of Caffeine",
    "Benefits of Mindfulness Meditation",
    "The Rise and Fall of the Roman Empire",
    "How Neural Networks Learn",
    "The Impact of Climate Change on Oceans"
];

const API_BASE = 'http://localhost:5001/api';

async function triggerJobs() {
    const jobIds = [];
    for (const topic of topics) {
        try {
            const resp = await axios.post(`${API_BASE}/generate`, {
                topic,
                duration_seconds: 30,
                tone: 'informative'
            });
            console.log(`[Triggered] "${topic}" -> Job ID: ${resp.data.job_id}`);
            jobIds.push({ id: resp.data.job_id, topic });
        } catch (err) {
            console.error(`[Error] Failed to trigger "${topic}":`, err.message);
        }
        // Small delay to prevent hitting local rate limits if any
        await new Promise(r => setTimeout(r, 500));
    }
    return jobIds;
}

async function monitorJobs(jobIds) {
    const results = [];
    let remaining = [...jobIds];

    while (remaining.length > 0) {
        console.log(`\n--- Monitoring ${remaining.length} remaining jobs ---`);
        const nextBatch = [];

        for (const job of remaining) {
            try {
                const resp = await axios.get(`${API_BASE}/status/${job.id}`);
                const status = resp.data.status;
                const result = resp.data.result;

                if (status === 'COMPLETED') {
                    console.log(`✅ [Job ${job.id}] COMPLETED: ${job.topic}`);
                    results.push({
                        id: job.id,
                        topic: job.topic,
                        auditorDecision: 'GO',
                        reason: resp.data.result?.auditor_reason || 'Passed all gates'
                    });
                } else if (status === 'FAILED') {
                    const error = resp.data.result?.error || 'Unknown failure';
                    console.error(`❌ [Job ${job.id}] FAILED: ${job.topic} (${error})`);
                    results.push({
                        id: job.id,
                        topic: job.topic,
                        auditorDecision: 'NO-GO',
                        reason: error
                    });
                } else {
                    console.log(`⏳ [Job ${job.id}] ${status}: ${job.topic} (${resp.data.progress}%) ${resp.data.step_info || ''}`);
                    nextBatch.push(job);
                }
            } catch (err) {
                console.error(`[Error] Failed to poll status for Job ${job.id}:`, err.message);
                nextBatch.push(job);
            }
        }

        remaining = nextBatch;
        if (remaining.length > 0) {
            await new Promise(r => setTimeout(r, 10000)); // Poll every 10s
        }
    }
    return results;
}

async function run() {
    console.log("Starting Phase 0 Baseline Generation...");
    const jobIds = await triggerJobs();
    const finalResults = await monitorJobs(jobIds);

    console.log("\n==============================");
    console.log("PHASE 0 BASELINE RESULTS");
    console.log("==============================");
    console.log(JSON.stringify(finalResults, null, 2));
}

run();
