const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:5001/api';

async function generateReport() {
    try {
        const resp = await axios.get(`${API_BASE}/jobs`);
        const jobs = resp.data;

        const report = {
            total_jobs: jobs.length,
            auditor_go: jobs.filter(j => j.status === 'COMPLETED').length,
            auditor_no_go: jobs.filter(j => j.status === 'FAILED').length,
            processing: jobs.filter(j => !['COMPLETED', 'FAILED'].includes(j.status)).length,
            human_strong: 0, // Placeholder
            human_ok: 0,     // Placeholder
            human_weak: 0,   // Placeholder
            details: jobs.map(j => ({
                job_id: j.id,
                topic: j.topic,
                status: j.status,
                auditor_decision: j.status === 'COMPLETED' ? 'GO' : (j.status === 'FAILED' ? 'NO-GO' : 'PENDING'),
                reason: j.result?.error || j.result?.auditor_reason || (j.status === 'FAILED' ? 'Unknown failure' : 'N/A')
            }))
        };

        fs.writeFileSync('phase0_final_report.json', JSON.stringify(report, null, 2), 'utf8');
        console.log('Report generated: phase0_final_report.json');

        // Print progress summary
        console.log(`Progress: ${report.total_jobs - report.processing}/${report.total_jobs} jobs finished.`);
        if (report.processing > 0) {
            console.log(`Active jobs: ${report.processing}`);
            jobs.filter(j => !['COMPLETED', 'FAILED'].includes(j.status)).forEach(j => {
                console.log(` - [${j.status}] ${j.topic} (${j.progress}%) - ${j.message || ''}`);
            });
        }
    } catch (err) {
        console.error('Failed to generate report:', err.message);
    }
}

generateReport();
