const express = require('express');
const cors = require('cors');
const config = require('./config');
const routes = require('./api/routes');
const worker = require('./workers/jobWorker');
const cleanupService = require('./services/cleanupService');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

// Expose static assets (for frontend access to generated videos)
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.use('/output', express.static(path.join(__dirname, '../temp_output')));
app.use('/cache', express.static(path.join(__dirname, '../cache_render')));

app.get('/', (req, res) => {
    res.json({
        message: 'Faceless Video Generator API',
        endpoints: {
            generate: 'POST /api/generate',
            status: 'GET /api/status/:id'
        }
    });
});

app.use('/api', routes);
app.use('/api/v1', routes); // Add v1 for compatibility with user attempts

const server = app.listen(config.PORT, () => {
    console.log(`[Server] running on port ${config.PORT} in ${config.NODE_ENV} mode.`);
    console.log(`[Server] Listening on http://localhost:${config.PORT}`);
    console.log(`[Server] Server is ready for requests`);
});

// Schedule these to run AFTER server is fully ready
setImmediate(() => {
    try {
        worker.start();
        console.log('[Server] Worker initialized successfully');
    } catch (err) {
        console.error('[Server] Error starting worker:', err.message);
    }
});

setImmediate(() => {
    try {
        cleanupService.init();
        console.log('[Server] Cleanup service initialized successfully');
    } catch (err) {
        console.error('[Server] Error starting cleanup service:', err.message);
    }
});

server.on('error', (err) => {
    console.error('[Server] Server Error:', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${config.PORT} is already in use`);
        process.exit(1);
    }
});

server.on('close', () => {
    console.log('[Server] Server closed');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught Exception:', error);
});
