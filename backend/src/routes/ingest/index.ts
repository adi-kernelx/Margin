import { Router } from 'express';
const router = Router();
router.post('/page', (req, res) => res.status(501).json({ error: 'Not Implemented (AWS removed)' }));
export default router;
