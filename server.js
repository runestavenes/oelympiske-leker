/* ============================================================
   server.js — Express entry point
   Serves static frontend from public/ and the JSON API.
   ============================================================ */

const express = require('express');
const path = require('path');
const api = require('./server/api');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use('/api', api);
app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Ølympiske Leker running on http://localhost:${port}`);
    if (!process.env.EVENT_PIN) {
        console.warn('WARNING: EVENT_PIN not set — using dev default "1234"');
    }
    if (!process.env.ADMIN_CODE) {
        console.warn('WARNING: ADMIN_CODE not set — using dev default "admin"');
    }
    if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
        console.warn('WARNING: AZURE_STORAGE_CONNECTION_STRING not set — using local file storage in .data/');
    }
});
