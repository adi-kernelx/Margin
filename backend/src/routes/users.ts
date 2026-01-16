import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import admin from 'firebase-admin';

const router = Router();
const db = admin.firestore();

// GET /api/users/me
router.get('/me', requireAuth, async (req, res) => {
    try {
        const uid = req.user!.uid;
        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
            // Auto-create if somehow missing (e.g. freshly created user via Auth but no DB doc yet)
            // Or just return 404. Ideally files/upload creates it? 
            // Better: Return default "user" role and 0 count if doc missing, so frontend doesn't crash.
            return res.json({
                role: 'user',
                fileCount: 0,
                maxFreeFiles: 5,
                isVip: false
            });
        }

        const data = userSnap.data();
        const role = data?.role || 'user';
        const fileCount = data?.fileCount || 0;
        const maxFreeFiles = data?.maxFreeFiles || 5;

        res.json({
            role,
            fileCount,
            maxFreeFiles,
            isVip: role === 'vip' || role === 'admin'
        });

    } catch (error) {
        console.error('Get user info failed:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// GET /api/users/list?q=... (Search users)
router.get('/list', requireAuth, async (req, res) => {
    try {
        const query = (req.query.q as string || '').toLowerCase();

        // List users from Firebase Auth
        // Note: listUsers() returns a batch (default 1000). For production, use pagination.
        const listUsersResult = await admin.auth().listUsers(100);

        let users = listUsersResult.users.map(u => ({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL
        }));

        if (query) {
            users = users.filter(u =>
                (u.email?.toLowerCase().includes(query)) ||
                (u.displayName?.toLowerCase().includes(query))
            );
        }

        // Limit results
        res.json({ users: users.slice(0, 20) });

    } catch (error) {
        console.error('List users failed:', error);
        res.status(500).json({ error: 'Failed to list users' });
    }
});

export default router;
