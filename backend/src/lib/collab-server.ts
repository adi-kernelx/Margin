import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { firestore } from './storage';
import { logAudit } from './audit';

import { persistence } from './collab-persistence';

// Hack to import setupWSConnection from y-websocket internal utils
// In a real TS setup you might need a module declaration or specific tsconfig path
const yUtils = require('y-websocket/bin/utils');
const setupWSConnection = yUtils.setupWSConnection;

// Register Persistence
yUtils.setPersistence(persistence);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-prod';

// Store active sockets mapped by Session ID
const activeSockets = new Map<string, WebSocket>();

// Store active sessions by FileID + UserID for easier lookup (optional optimization)
// Or just iterate activeSockets if needed (for MVP iteration is fine if low scale).
// Map<fileId, Map<uid, Set<sid>>>? 
// Let's stick to simple map for now and iterate for "Revoke All for User".

export function revokeSession(sid: string) {
    const ws = activeSockets.get(sid);
    if (ws) {
        console.log(`[Collab] Revoking session ${sid}`);
        ws.close(4403, 'Permission Revoked'); // 4xxx codes usually application specific
        activeSockets.delete(sid);
        return true;
    }
    return false;
}

export function revokeUserFileAccess(fileId: string, uid: string) {
    // Iterate all active sockets to find matches
    // In production, use a reverse index or Redis.
    let count = 0;
    for (const [sid, ws] of activeSockets.entries()) {
        const context = (ws as any)._collabContext;
        if (context && context.fid === fileId && context.uid === uid) {
            console.log(`[Collab] Revoking access for ${uid} on ${fileId} (sid: ${sid})`);
            ws.close(4403, 'Permission Revoked');
            activeSockets.delete(sid);
            count++;
        }
    }
    return count;
}

export function setupCollabServer(httpServer: Server) {
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', async (request, socket, head) => {
        // ... (Upgrade logic same as before) ...
        // Only handle /collab/ws path
        if (!request.url?.startsWith('/collab/ws')) {
            return;
        }

        const url = new URL(request.url, `http://${request.headers.host}`);
        const token = url.searchParams.get('token');

        if (!token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        try {
            // 1. Verify Token
            const payload = jwt.verify(token, JWT_SECRET) as any;
            const { sid, fid, role, uid } = payload;

            // 2. Check Session Validity (Revocation)
            const sessionDoc = await firestore.collection('collabSessions').doc(sid).get();
            if (!sessionDoc.exists || sessionDoc.data()?.revoked) {
                throw new Error('Session revoked or invalid');
            }

            // 3. proceed
            wss.handleUpgrade(request, socket, head, (ws) => {
                // Attach context for lookup
                (ws as any)._collabContext = { fid, role, uid, sid };
                wss.emit('connection', ws, request, { fid, role, uid, sid });
            });

        } catch (err) {
            console.error('WebSocket Auth Failed:', err);
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
        }
    });

    wss.on('connection', (ws: WebSocket, req: any, context: any) => {
        const { fid, role, uid, sid } = context;

        // Track Session
        activeSockets.set(sid, ws);

        // Setup Yjs Connection
        setupWSConnection(ws, req, { docName: fid });

        if (role === 'view') {
            // TODO: Implement Write Blocking
        }

        console.log(`Collab: User ${uid} joined ${fid} (${role})`);

        logAudit({
            actor: uid,
            action: 'yjs_connect',
            resourceId: fid,
            resourceType: 'file',
            meta: { sid, role }
        });

        ws.on('close', () => {
            activeSockets.delete(sid);
        });
    });

    return wss;
}
