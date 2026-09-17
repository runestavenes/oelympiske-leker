/* ============================================================
   auth.js — shared event PIN (players) + admin passcode
   ============================================================ */

const crypto = require('crypto');

const EVENT_PIN = process.env.EVENT_PIN || '1234';
const ADMIN_CODE = process.env.ADMIN_CODE || 'admin';

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function isPlayer(req) {
    return safeEqual(req.get('X-Event-Pin') || '', EVENT_PIN) || isAdmin(req);
}

function isAdmin(req) {
    return safeEqual(req.get('X-Admin-Code') || '', ADMIN_CODE);
}

function requirePlayer(req, res, next) {
    if (!isPlayer(req)) return res.status(401).json({ error: 'Invalid event PIN' });
    next();
}

function requireAdmin(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Invalid admin code' });
    next();
}

module.exports = { requirePlayer, requireAdmin, isPlayer, isAdmin };
