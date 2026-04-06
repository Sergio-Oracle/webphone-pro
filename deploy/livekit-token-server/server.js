// LiveKit Token Server — SENDT
// Génère des JWT LiveKit après vérification du token Matrix de l'utilisateur.
// Écoute sur 127.0.0.1:3001 — jamais exposé directement, proxifié par Nginx.

'use strict';

const http   = require('http');
const url    = require('url');
const crypto = require('crypto');
const fetch  = require('node-fetch');

// ── Configuration — chargée depuis .env via systemd EnvironmentFile ──────────
const LIVEKIT_API_KEY    = process.env.LIVEKIT_API_KEY    || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const MATRIX_HOMESERVER  = process.env.MATRIX_HOMESERVER  || 'https://localhost:8008';
const LIVEKIT_URL        = process.env.LIVEKIT_URL        || 'wss://localhost:7880';
const PORT               = parseInt(process.env.PORT      || '3001', 10);
const HOST               = '127.0.0.1';

if (!LIVEKIT_API_SECRET) {
    console.error('[token-server] ERREUR: LIVEKIT_API_SECRET non défini dans .env');
    process.exit(1);
}

// ── JWT LiveKit (HS256) ───────────────────────────────────────────────────────
function b64url(buf) {
    return Buffer.from(buf).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateToken(roomName, identity) {
    const now = Math.floor(Date.now() / 1000);
    const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
        iss: LIVEKIT_API_KEY,
        sub: identity,
        iat: now,
        exp: now + 3600,
        name: identity,
        video: {
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true
        }
    }));
    const input = `${header}.${payload}`;
    const sig   = crypto.createHmac('sha256', LIVEKIT_API_SECRET).update(input).digest();
    return `${input}.${b64url(sig)}`;
}

// ── Vérification du token Matrix ──────────────────────────────────────────────
async function verifyMatrixToken(accessToken) {
    if (!accessToken) return null;
    try {
        const res = await fetch(`${MATRIX_HOMESERVER}/_matrix/client/v3/account/whoami`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            timeout: 5000
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.user_id || null;
    } catch (e) {
        return null;
    }
}

// ── Serveur HTTP ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // CORS — à adapter selon votre domaine
    const origin = req.headers['origin'];
    if (origin && origin.startsWith('https://')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
    }

    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;

    if (pathname !== '/api/connection-details') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
    }

    const authHeader  = req.headers['authorization'] || '';
    const matrixToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const userId = await verifyMatrixToken(matrixToken);

    if (!userId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: invalid Matrix token' }));
        return;
    }

    const roomName = parsed.query.room;
    if (!roomName || typeof roomName !== 'string' || roomName.length > 256) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Request: missing or invalid room parameter' }));
        return;
    }

    try {
        const token = await generateToken(roomName, userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token, url: LIVEKIT_URL }));
    } catch (e) {
        console.error('[token-server] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[token-server] Listening on ${HOST}:${PORT}`);
    console.log(`[token-server] Matrix homeserver: ${MATRIX_HOMESERVER}`);
    console.log(`[token-server] LiveKit URL: ${LIVEKIT_URL}`);
});

process.on('uncaughtException', (e) => console.error('[token-server] Uncaught:', e.message));
