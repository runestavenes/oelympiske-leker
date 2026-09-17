/* ============================================================
   storage.js — Tournament persistence
   Azure Blob Storage (ETag optimistic concurrency) when
   AZURE_STORAGE_CONNECTION_STRING is set, otherwise local
   JSON files in .data/ for development.

   Layout:
     index.json            { activeId, tournaments: [{id, name, createdAt}] }
     tournaments/{id}.json  full tournament state (see emptyTournament)
   ============================================================ */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const CONTAINER = process.env.STORAGE_CONTAINER || 'tournaments';
const MAX_RETRIES = 5;

// ── Default data ─────────────────────────────────────────────

function getDefaultActivities() {
    return [
        { id: 'dart', name: 'Dart', scoreType: 'numeric', min: 0, max: 3, winPoints: 1, drawPoints: 1, lossPoints: 0, marginMultiplier: 0, fixedBonus: 0, inSchedule: true, weight: 1 },
        { id: 'pushups', name: 'Push Ups', scoreType: 'winlose', min: 0, max: 1, winPoints: 4, drawPoints: 1, lossPoints: 0, marginMultiplier: 0, fixedBonus: 0, inSchedule: true, weight: 1 },
        { id: 'sorting', name: 'Sorting', scoreType: 'winlose', min: 0, max: 1, winPoints: 4, drawPoints: 1, lossPoints: 0, marginMultiplier: 0, fixedBonus: 0, inSchedule: true, weight: 1 },
        { id: 'beerpong', name: 'Beerpong', scoreType: 'numeric', min: 0, max: 4, winPoints: 1, drawPoints: 1, lossPoints: 0, marginMultiplier: 1, fixedBonus: 0, inSchedule: true, weight: 1 },
        { id: 'flipcup', name: 'Flip Cup', scoreType: 'winlose', min: 0, max: 1, winPoints: 4, drawPoints: 1, lossPoints: 0, marginMultiplier: 0, fixedBonus: 0, inSchedule: true, weight: 1 },
        { id: 'fyrstikkiq', name: 'Fyrstikk IQ', scoreType: 'numeric', min: 0, max: 3, winPoints: 1, drawPoints: 3, lossPoints: 0, marginMultiplier: 1, fixedBonus: 0, inSchedule: true, weight: 0.5 },
        { id: 'boccia', name: 'Boccia', scoreType: 'numeric', min: 0, max: 10, winPoints: 3, drawPoints: 1, lossPoints: 0, marginMultiplier: 1, fixedBonus: 0, inSchedule: false },
        { id: 'kubespillet', name: 'Kubespillet', scoreType: 'numeric', min: 0, max: 10, winPoints: 3, drawPoints: 1, lossPoints: 0, marginMultiplier: 1, fixedBonus: 0, inSchedule: false },
        { id: 'kongekuben', name: 'Kongekuben', scoreType: 'numeric', min: 0, max: 10, winPoints: 3, drawPoints: 1, lossPoints: 0, marginMultiplier: 1, fixedBonus: 0, inSchedule: false },
        { id: 'hestelop', name: 'Hesteløp', scoreType: 'numeric', min: 0, max: 10, winPoints: 3, drawPoints: 1, lossPoints: 0, marginMultiplier: 1, fixedBonus: 0, inSchedule: false }
    ];
}

function emptyTournament(name) {
    return {
        name: name,
        createdAt: new Date().toISOString(),
        version: 1,
        updatedAt: new Date().toISOString(),
        teams: [],
        activities: getDefaultActivities(),
        schedule: [],
        preScores: [],
        romanticObs: [],
        lastActions: {}
    };
}

// ── Storage drivers ──────────────────────────────────────────
// Both expose: read(key) -> { data, etag } | null
//              write(key, data, etag|null) -> newEtag (throws {conflict:true} on ETag mismatch)

function createBlobDriver() {
    const { BlobServiceClient } = require('@azure/storage-blob');
    const service = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const container = service.getContainerClient(CONTAINER);
    let ensured = false;

    async function ensureContainer() {
        if (!ensured) {
            await container.createIfNotExists();
            ensured = true;
        }
    }

    return {
        async read(key) {
            await ensureContainer();
            const blob = container.getBlockBlobClient(key);
            try {
                const buf = await blob.downloadToBuffer();
                const props = await blob.getProperties();
                return { data: JSON.parse(buf.toString('utf8')), etag: props.etag };
            } catch (err) {
                if (err.statusCode === 404) return null;
                throw err;
            }
        },
        async write(key, data, etag) {
            await ensureContainer();
            const blob = container.getBlockBlobClient(key);
            const body = JSON.stringify(data);
            const conditions = etag ? { ifMatch: etag } : { ifNoneMatch: '*' };
            try {
                const res = await blob.upload(body, Buffer.byteLength(body), {
                    conditions,
                    blobHTTPHeaders: { blobContentType: 'application/json' }
                });
                return res.etag;
            } catch (err) {
                if (err.statusCode === 412 || err.statusCode === 409) {
                    const e = new Error('etag conflict');
                    e.conflict = true;
                    throw e;
                }
                throw err;
            }
        },
        async remove(key) {
            await ensureContainer();
            await container.getBlockBlobClient(key).deleteIfExists();
        }
    };
}

function createFileDriver() {
    const root = path.join(__dirname, '..', '.data');
    const etags = new Map(); // emulated etags for dev

    function filePath(key) {
        return path.join(root, key.replace(/\//g, '_') + '.json');
    }

    return {
        async read(key) {
            try {
                const raw = await fs.readFile(filePath(key), 'utf8');
                if (!etags.has(key)) etags.set(key, crypto.randomUUID());
                return { data: JSON.parse(raw), etag: etags.get(key) };
            } catch (err) {
                if (err.code === 'ENOENT') return null;
                throw err;
            }
        },
        async write(key, data, etag) {
            const current = etags.get(key) || null;
            const exists = await fs.access(filePath(key)).then(() => true, () => false);
            if (etag ? etag !== current : exists) {
                const e = new Error('etag conflict');
                e.conflict = true;
                throw e;
            }
            await fs.mkdir(root, { recursive: true });
            await fs.writeFile(filePath(key), JSON.stringify(data, null, 2), 'utf8');
            const next = crypto.randomUUID();
            etags.set(key, next);
            return next;
        },
        async remove(key) {
            await fs.rm(filePath(key), { force: true });
            etags.delete(key);
        }
    };
}

const driver = process.env.AZURE_STORAGE_CONNECTION_STRING ? createBlobDriver() : createFileDriver();

// In-process write queue reduces ETag conflicts between concurrent requests
let queue = Promise.resolve();
function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

// ── Index (tournament list + active pointer) ─────────────────

const INDEX_KEY = 'index';

async function readIndex() {
    const found = await driver.read(INDEX_KEY);
    if (found) return found;
    // First run: seed with one tournament (create-if-absent write handles races)
    const id = crypto.randomUUID().slice(0, 8);
    const t = emptyTournament('Ølympiske Leker');
    await driver.write(tournamentKey(id), t, null);
    const index = { activeId: id, tournaments: [{ id, name: t.name, createdAt: t.createdAt }] };
    try {
        const etag = await driver.write(INDEX_KEY, index, null);
        return { data: index, etag };
    } catch (err) {
        if (err.conflict) {
            await driver.remove(tournamentKey(id));
            return driver.read(INDEX_KEY);
        }
        throw err;
    }
}

function tournamentKey(id) {
    return 'tournaments/' + id;
}

// ── Public API ────────────────────────────────────────────────

async function getIndex() {
    return (await readIndex()).data;
}

async function getActiveTournament() {
    const index = await getIndex();
    const found = await driver.read(tournamentKey(index.activeId));
    if (!found) throw new Error('Active tournament blob missing: ' + index.activeId);
    return { id: index.activeId, state: found.data };
}

/**
 * Atomically mutate the active tournament with ETag retry.
 * mutator(state) edits state in place (or returns falsy to abort).
 * Returns { id, state }.
 */
async function mutateActive(mutator) {
    return serialized(async () => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const index = await getIndex();
            const key = tournamentKey(index.activeId);
            const found = await driver.read(key);
            if (!found) throw new Error('Active tournament blob missing');
            const state = found.data;
            const result = mutator(state);
            if (result === false) return { id: index.activeId, state };
            state.version = (state.version || 0) + 1;
            state.updatedAt = new Date().toISOString();
            try {
                await driver.write(key, state, found.etag);
                return { id: index.activeId, state };
            } catch (err) {
                if (err.conflict && attempt < MAX_RETRIES - 1) continue;
                throw err;
            }
        }
        throw new Error('Storage conflict: retries exhausted');
    });
}

/** Atomically mutate the index (tournament list / active pointer). */
async function mutateIndex(mutator) {
    return serialized(async () => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const found = await readIndex();
            const index = found.data;
            const result = await mutator(index);
            if (result === false) return index;
            try {
                await driver.write(INDEX_KEY, index, found.etag);
                return index;
            } catch (err) {
                if (err.conflict && attempt < MAX_RETRIES - 1) continue;
                throw err;
            }
        }
        throw new Error('Storage conflict: retries exhausted');
    });
}

async function createTournament(name) {
    const id = crypto.randomUUID().slice(0, 8);
    const t = emptyTournament(name);
    await driver.write(tournamentKey(id), t, null);
    await mutateIndex(index => {
        index.tournaments.push({ id, name, createdAt: t.createdAt });
    });
    return id;
}

async function activateTournament(id) {
    await mutateIndex(index => {
        if (!index.tournaments.some(t => t.id === id)) throw notFound('Tournament not found');
        index.activeId = id;
    });
}

async function deleteTournament(id) {
    await mutateIndex(index => {
        if (index.activeId === id) throw badRequest('Cannot delete the active tournament');
        if (!index.tournaments.some(t => t.id === id)) throw notFound('Tournament not found');
        index.tournaments = index.tournaments.filter(t => t.id !== id);
    });
    await driver.remove(tournamentKey(id));
}

async function renameActiveInIndex(name) {
    await mutateIndex(index => {
        const entry = index.tournaments.find(t => t.id === index.activeId);
        if (entry) entry.name = name;
    });
}

function notFound(msg) { const e = new Error(msg); e.status = 404; return e; }
function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }

module.exports = {
    getIndex,
    getActiveTournament,
    mutateActive,
    createTournament,
    activateTournament,
    deleteTournament,
    renameActiveInIndex,
    emptyTournament,
    getDefaultActivities
};
