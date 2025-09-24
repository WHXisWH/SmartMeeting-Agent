import { Express } from 'express';
import { agentRoutes } from './agentRoutes.js';
import { authRoutes } from './authRoutes.js';
import { VertexAgentService } from '../../services/VertexAgentService.js';
import { workspaceRoutes } from './workspaceRoutes.js';
import { speechRoutes } from './speechRoutes.js';
import { minutesRoutes } from './minutesRoutes.js';
import { adminRoutes } from './adminRoutes.js';
import { adminKnowledgeRoutes } from './adminKnowledgeRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { watchAdminRoutes } from './watchAdminRoutes.js';
import { jobsRoutes } from './jobsRoutes.js';
import { taskRoutes } from './taskRoutes.js';
import { actionItemsRoutes } from './actionItemsRoutes.js';
import { reportsRoutes } from './reportsRoutes.js';
const vertexAgentService = new VertexAgentService();

export function setupRoutes(app: Express, agentBrain: any): void {
  const apiPrefix = '/api';

  // Lightweight health endpoint: does not ping Vertex AI by default
  app.get('/health', async (req, res) => {
    const timestamp = new Date().toISOString();
    const agentInitStatus = agentBrain.getInitializationStatus();

    // Config readiness flags
    const baseUrl = process.env.BACKEND_BASE_URL || process.env.WEBHOOK_BASE_URL || '';
    const backendBaseUrlConfigured = Boolean(baseUrl && /^https?:\/\//.test(baseUrl));
    let oauthReady = false;
    try {
      const email = process.env.DEFAULT_USER_EMAIL || '';
      if (email) {
        const { Firestore } = await import('@google-cloud/firestore');
        const db = new Firestore();
        const snap = await db.collection('oauth_tokens').doc(email).get();
        const data = snap.exists ? (snap.data() as any) : null;
        oauthReady = Boolean(data?.refresh_token);
      }
    } catch {}

    // Optional Vertex ping (off by default to avoid unintended cost)
    const shouldPingVertex = String(process.env.HEALTH_PING_VERTEX || '').toLowerCase() === 'true';
    let agentBuilderStatus: any = { status: 'skipped' };
    if (shouldPingVertex) {
      try {
        agentBuilderStatus = await vertexAgentService.pingAgentBuilder();
      } catch (error) {
        agentBuilderStatus = { status: 'error', message: (error as Error).message };
      }
    }

    res.status(200).json({
      status: 'healthy',
      timestamp,
      agent_builder: agentBuilderStatus.status,
      vertex_ai: vertexAgentService.getStatus(),
      legacy_agent: {
        initialized: agentInitStatus.initialized,
        initializing: agentInitStatus.initializing,
        error: agentInitStatus.error
      },
      readiness: {
        backend_base_url_configured: backendBaseUrlConfigured,
        oauth_ready: oauthReady
      }
    });
  });

  // Stage 1 验收端点：Agent Builder ping test
  app.get(`${apiPrefix}/agent-builder/ping`, async (req, res) => {
    try {
      const result = await vertexAgentService.pingAgentBuilder();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: 'Agent Builder への接続確認に失敗しました',
        error: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Stage 1 验收端点：Agent Builder test call
  app.post(`${apiPrefix}/agent-builder/test`, async (req, res) => {
    try {
      const { prompt = "SmartMeet Agent からの接続テストです" } = req.body;
      const result = await vertexAgentService.testAgentBuilderCall(prompt);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: 'Agent Builder へのテスト呼び出しに失敗しました',
        error: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  });

  app.use(`${apiPrefix}/agent`, agentRoutes(agentBrain, vertexAgentService));

  // Auth endpoints
  // - Mount under /auth for browser redirects (login/callback)
  // - Mount under /api/auth for programmatic status checks
  app.use('/auth', authRoutes());
  app.use(`${apiPrefix}/auth`, authRoutes());

  // Workspace bridges for frontend pages (Calendar/Gmail/Drive)
  app.use(apiPrefix, workspaceRoutes());

  // Speech-to-Text and Minutes
  // Mount minutesRoutes BEFORE speechRoutes to override /agent/minutes/generate with the enhanced version
  app.use('/api', minutesRoutes());
  app.use('/api', speechRoutes());

  // Admin endpoints (policy apply)
  app.use(`${apiPrefix}/admin`, adminRoutes(agentBrain));
  // Knowledge admin endpoints
  app.use(`${apiPrefix}/admin/knowledge`, adminKnowledgeRoutes());

  // Webhooks (Gmail/Calendar)
  app.use(webhookRoutes());
  // Watch admin
  app.use(watchAdminRoutes());
  // Internal jobs (process queue, scan offers)
  app.use(jobsRoutes());
  // Pub/Sub task worker endpoint
  app.use(taskRoutes());
  // Action items distribution
  app.use(actionItemsRoutes());
  // Reports
  app.use(reportsRoutes());

  // Cloud Trace status endpoint
  app.get(`${apiPrefix}/trace/status`, (req, res) => {
    try {
      const { CloudTraceService } = require('../../services/CloudTraceService.js');
      const tracer = new CloudTraceService();
      const status = tracer.getStatus();
      res.json({
        tracing: status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get trace status',
        message: (error as Error).message
      });
    }
  });

  app.get(apiPrefix, (req, res) => {
    res.json({
      message: 'SmartMeet AI Agent API は稼働中です',
      version: '1.0',
      stage: 'ステージ1: Vertex AI Agent Builder 連携'
    });
  });
}
