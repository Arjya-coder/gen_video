const axios = require('axios');
const fs = require('fs');
const path = require('path');

const jobIds = [
    "31771a11-547f-4815-94da-15ea93279cb1",
    "3220836e-9baa-489f-8ce3-df2ec779a958",
    "39257cbf-a581-4b8e-adff-0ba0797d9f45",
    "4952bb22-1a10-412b-bc5c-0316852b68bf",
    "5dc55c17-5287-4126-a04a-49c1674ad5df",
    "67063317-9b75-43c6-86af-bd1cab08082d",
    "ae82a10d-8bd4-4b85-a97e-c291d16db636",
    "cac2cd2a-6c2d-4a53-b61d-f58399d74941",
    "e73ff011-a224-4664-a41c-9583d045102f",
    "7ffc8f08-3bc0-48c6-9606-61edc010013a",
    "dbb77297-fd19-49d8-a1fc-290254db36ce",
    "7f06bddf-df16-47e7-8c20-cf7cf4c921bf",
    "9213164c-2975-47d5-b64e-f0b4078c796b",
    "74556fac-0559-4ed5-add7-919e40e974b8",
    "8ce33b88-592f-4886-8d51-408ca428c16e",
    "1512eaf5-908c-4f30-9692-3ee510af8743"
];

const API_BASE = 'http://localhost:5001/api';

async function generateReport() {
    const results = [];
    for (const jobId of [...new Set(jobIds)]) {
        try {
            const resp = await axios.get(`${API_BASE}/status/${jobId}`);
            results.push({
                job_id: jobId,
                topic: resp.data.topic || 'Unknown',
                status: resp.data.status,
                auditor_decision: resp.data.status === 'COMPLETED' ? 'GO' : 'NO-GO',
                reason: resp.data.result?.error || resp.data.result?.auditor_reason || 'N/A'
            });
        } catch (err) {
            // Probably from a different run
        }
    }
    console.log(JSON.stringify(results, null, 2));
}

generateReport();
