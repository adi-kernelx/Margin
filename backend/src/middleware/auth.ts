import { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized: Missing Authorization header' });
    }

    // 1. Production: Firebase Bearer Token
    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        try {
            // Check if Firebase Admin is properly initialized
            if (admin.apps.length === 0) {
                console.error('Firebase Admin not initialized!');
                return res.status(500).json({ error: 'Server configuration error: Firebase not initialized' });
            }

            const decodedToken = await admin.auth().verifyIdToken(token);
            req.user = {
                uid: decodedToken.uid,
                email: decodedToken.email
            };
            console.log(`[Auth] Verified user: ${decodedToken.uid}`);
            return next();
        } catch (error: any) {
            console.error('Firebase Auth Failed:', error.code, error.message);
            return res.status(403).json({ error: 'Unauthorized: Invalid Token', details: error.message });
        }
    }

    // 2. Dev Mock: (Deprecated but kept for transition)
    // "Mock <uid>" or "Mock Owner"
    if (authHeader.startsWith('Mock ')) {
        const val = authHeader.split(' ')[1];
        if (val === 'Owner') {
            req.user = { uid: 'owner-uid-1', email: 'aditya308989@gmail.com' };
        } else {
            req.user = { uid: val, email: 'mock@example.com' };
        }
        return next();
    }

    res.status(401).json({ error: 'Unauthorized: Invalid header format' });
};

export const requireAuthOptional = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        // No header, treat as anonymous
        return next();
    }

    if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        try {
            if (admin.apps.length > 0) {
                const decodedToken = await admin.auth().verifyIdToken(token);
                req.user = { uid: decodedToken.uid, email: decodedToken.email };
            }
        } catch (error) {
            console.warn('Optional auth token failed:', error);
        }
    } else if (authHeader.startsWith('Mock ')) {
        const val = authHeader.split(' ')[1];
        req.user = { uid: val, email: 'mock@example.com' };
    }

    next();
};
