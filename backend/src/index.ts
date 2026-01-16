import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import filesRouter from './routes/files';
import { generalLimiter, uploadLimiter, shareLimiter, processLimiter, searchLimiter, adminLimiter } from './middleware/rate-limit';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;

// Allowed origins for CORS - configure based on environment
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://localhost:3000'];

const app = express();

// CORS configuration - restrict to allowed origins in production
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or Postman)
        if (!origin) return callback(null, true);

        if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

// Apply general rate limiting to all routes
app.use(generalLimiter);

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Health - no rate limiting needed
app.get('/health', (req, res) => {
    res.json({ ok: true, ts: Date.now() });
});

// Routes with specific rate limiters
app.use('/api/files', uploadLimiter, filesRouter);

import annotationsRouter from './routes/annotations';
import adminVipRouter from './routes/admin/vip';
import usersRouter from './routes/users';
import shareRouter from './routes/share';
import collabRouter from './routes/collab';
import ingestRouter from './routes/ingest';
import ocrRouter from './routes/ocr';
import testSearchRouter from './routes/test-search';
import searchHybridRouter from './routes/search-hybrid';
import localFilesRouter from './routes/local-files';

app.use('/api/files/:fileId/annotations', annotationsRouter);
app.use('/api/admin', adminLimiter, adminVipRouter);
app.use('/api/users', usersRouter);
app.use('/api/share', shareLimiter, shareRouter);
app.use('/api/collab', collabRouter);
app.use('/api/ingest', processLimiter, ingestRouter);
app.use('/api', processLimiter, ocrRouter);
app.use('/api/test-search', searchLimiter, testSearchRouter);
app.use('/api', searchLimiter, searchHybridRouter);
app.use('/api/local-files', localFilesRouter);

// Global error handler - catches any unhandled errors
// SECURITY: Don't expose error details in production
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err.stack || err);

    // Don't expose internal error details in production
    if (process.env.NODE_ENV === 'production') {
        res.status(500).json({ error: 'Internal Server Error' });
    } else {
        res.status(500).json({ error: 'Internal Server Error', details: err?.message || String(err) });
    }
});

import { setupCollabServer } from './lib/collab-server';
import { firestore } from './lib/storage';

// Auto-migration: Add ownerUid to folders that are missing it
async function migrateExistingFolders() {
    console.log('[Migration] Checking for folders missing ownerUid...');
    try {
        const childrenSnap = await firestore.collectionGroup('children')
            .where('type', '==', 'folder')
            .limit(500)
            .get();

        let migrated = 0;
        for (const doc of childrenSnap.docs) {
            const data = doc.data();
            if (!data.ownerUid && data.createdBy) {
                await doc.ref.update({ ownerUid: data.createdBy });
                migrated++;
            }
        }

        if (migrated > 0) {
            console.log(`[Migration] Fixed ${migrated} folders by adding ownerUid`);
        } else {
            console.log('[Migration] All folders have ownerUid set');
        }
    } catch (err) {
        console.warn('[Migration] Could not run folder migration:', err);
    }
}

const server = app.listen(PORT, () => {
    console.log(`Backend listening on ${PORT} — health: http://localhost:${PORT}/health`);
});

setupCollabServer(server);
