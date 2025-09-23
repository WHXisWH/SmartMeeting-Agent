import { Router } from 'express';
import { FirestoreService } from '../../services/FirestoreService.js';

export function adminKnowledgeRoutes(): Router {
  const router = Router();
  const fsSvc = new FirestoreService();

  // List knowledge (semantic/procedural/episodic), filter by approved
  router.get('/:type', async (req, res) => {
    try {
      const type = String(req.params.type);
      const approved = req.query.approved !== undefined ? req.query.approved === 'true' : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : undefined;
      if (type === 'episodic') {
        const logs = await fsSvc.getActivityLog(limit || 50);
        const items = logs.map(l => ({ id: l.id, title: l.message || 'activity', timestamp: l.timestamp || l.serverTimestamp, data: l.data || {} }));
        return res.json({ items });
      }
      if (!['semantic','procedural'].includes(type)) return res.status(400).json({ error: 'invalid type' });
      const items = await fsSvc.listKnowledge(type as any, { approved, limit });
      return res.json({ items });
    } catch (e) {
      res.status(500).json({ error: 'Failed to list knowledge', details: (e as Error).message });
    }
  });

  // Approve knowledge item
  router.post('/:type/approve', async (req, res) => {
    try {
      const type = (req.params.type as 'semantic'|'procedural');
      const { id, approver } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      await fsSvc.approveKnowledge(type, id, approver || 'admin');
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: 'Failed to approve knowledge', details: (e as Error).message });
    }
  });

  // Approve for episodic is not applicable; no route provided.

  return router;
}
