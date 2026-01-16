import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import admin from 'firebase-admin';

const router = Router();
const db = admin.firestore();

// Middleware to check if requester is Admin
const requireAdmin = async (req: any, res: any, next: any) => {
    const uid = req.user!.uid;
    const email = req.user!.email;

    // 1. Hardcoded Override (for safety/bootstrap)
    if (email === 'aditya308989@gmail.com') {
        return next();
    }

    // 2. Check DB Role
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists && userDoc.data()?.role === 'admin') {
        return next();
    }

    return res.status(403).json({ error: 'Access denied: Admins only' });
};

// POST /api/admin/vip/:uid
router.post('/vip/:targetUid', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { targetUid } = req.params;
        const adminUid = req.user!.uid;

        await db.collection('users').doc(targetUid).set({
            role: 'vip',
            vipGrantedBy: adminUid,
            vipGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        res.json({ ok: true, message: `User ${targetUid} promoted to VIP` });
    } catch (error) {
        console.error('Grant VIP failed:', error);
        res.status(500).json({ error: 'Grant VIP failed' });
    }
});

// DELETE /api/admin/vip/:uid (Revoke)
router.delete('/vip/:targetUid', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { targetUid } = req.params;

        await db.collection('users').doc(targetUid).update({
            role: 'user',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ ok: true, message: `User ${targetUid} demoted to User` });
    } catch (error) {
        console.error('Revoke VIP failed:', error);
        res.status(500).json({ error: 'Revoke VIP failed' });
    }
});

export default router;
