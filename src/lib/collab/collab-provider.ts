// src/lib/collab/collab-provider.ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { auth } from '@/lib/firebase/config';

const BACKEND_URL = 'http://localhost:4000'; // Make sure this matches env
const WS_URL = 'ws://localhost:4000/collab/ws'; // Adjust for prod

export interface CollabSession {
    doc: Y.Doc;
    provider: WebsocketProvider | null;
    persistence: IndexeddbPersistence | null;
    awareness: any;
    disconnect: () => void;
}

export async function joinCollabSession(
    fileId: string,
    shareId?: string,
    linkToken?: string,
    parentFolderId?: string
): Promise<CollabSession> {

    // 1. Get Room Token from Backend
    // This authenticates us and checks permission
    const token = await fetchRoomToken(fileId, shareId, linkToken, parentFolderId);

    // 2. Setup Yjs Doc
    const doc = new Y.Doc();

    // 3. Setup Persistence (Offline Support)
    // We use y-indexeddb to store the doc locally.
    // This allows offline edits and faster load.
    const persistence = new IndexeddbPersistence(`file-${fileId}`, doc);

    // Wait for data to be loaded from local DB
    // persistence.once('synced', () => console.log('Local content loaded'));

    // 4. Setup WebSocket Provider
    // We pass the token in the query string as required by our server
    const provider = new WebsocketProvider(WS_URL, '', doc, {
        params: { token }
    });

    // Handle Auth Failures (Revocation)
    provider.on('connection-close', (event: any) => {
        // y-websocket tries to reconnect automatically. 
        // If server sent code 4403 or similar, we might want to stop.
        // But websocket standard close codes are limited.
        console.log('Collab WS closed', event);
    });

    provider.on('status', (event: any) => {
        console.log('Collab status:', event.status); // 'connected' or 'disconnected'
    });

    return {
        doc,
        provider,
        persistence,
        awareness: provider.awareness,
        disconnect: () => {
            provider.destroy();
            persistence.destroy();
            doc.destroy();
        }
    };
}

async function fetchRoomToken(fileId: string, shareId?: string, linkToken?: string, parentFolderId?: string) {
    let authToken = null;
    if (auth.currentUser) {
        authToken = await auth.currentUser.getIdToken();
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const payload = { fileId, shareId, linkToken, parentFolderId };

    const res = await fetch(`${BACKEND_URL}/api/collab/join`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        if (res.status === 403 || res.status === 401) {
            throw new Error("Access Denied");
        }
        throw new Error("Failed to join collaboration session");
    }

    const data = await res.json();
    return data.token;
}
