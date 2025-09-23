import { Router } from 'express';
import { FirestoreService } from '../../services/FirestoreService.js';

export function adminRoutes(agentBrain: any): Router {
  const router = Router();
  const store = new FirestoreService();

  // 获取最新策略
  router.get('/policies/latest', async (_req, res) => {
    try {
      const policy = await store.getLatestPolicy();
      res.json({ policy });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // 应用策略（并持久化版本）
  router.post('/policies/apply', async (req, res) => {
    try {
      const incoming = req.body?.policy;
      if (!incoming) return res.status(400).json({ error: 'policy is required' });
      if (typeof agentBrain.applyPolicy === 'function') {
        const applied = agentBrain.applyPolicy(incoming);
        const id = await store.savePolicyVersion(incoming, 'manual_apply', { appliedAt: new Date().toISOString() });
        return res.json({ ok: true, applied, versionId: id });
      }
      return res.status(500).json({ error: 'agentBrain.applyPolicy not available' });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
}

