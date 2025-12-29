const axios = require('axios');

const jobIds = [
    "7ffc8f08-3bc0-48c6-9606-61edc010013a",
    "dbb77297-fd19-49d8-a1fc-290254db36ce",
    "7f06bddf-df16-47e7-8c20-cf7cf4c921bf",
    "9213164c-2975-47d5-b64e-f0b4078c796b",
    "74556fac-0559-4ed5-add7-919e40e974b8",
    "8ce33b88-592f-4886-8d51-408ca428c16e",
    "35941263-191d-40cd-aa2c-3565aedf9849", // Wait, this is a background command ID?
    // Let me get the actual job IDs from the previous output logs if available.
];

// I will search the logs for Job IDs.
