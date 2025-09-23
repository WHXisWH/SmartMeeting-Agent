import { Router } from 'express';
import { PubSub } from '@google-cloud/pubsub';
import { Firestore } from '@google-cloud/firestore';
import axios from 'axios';
import { Metrics } from '../../utils/Metrics.js';
import { CloudTraceService } from '../../services/CloudTraceService.js';

function decodeBase64Json(b64?: string): any {
  if (!b64) return {};
  try {
    const s = Buffer.from(b64, 'base64').toString('utf-8');
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function publishDlq(message: any): Promise<void> {
  try {
    const topic = process.env.PUBSUB_TOPIC_DLQ || 'sm-tasks-dlq';
    const pubsub = new PubSub();
    await pubsub.topic(topic).publishMessage({ json: message });
  } catch {}
}

async function callDecisionAnalyze(context: string) {
  const url = process.env.CF_DECISION_URL || '';
  if (!url) return;
  const headers: any = { 'Content-Type': 'application/json' };
  const secret = process.env.SM_SHARED_SECRET || '';
  if (secret) headers['X-Shared-Secret'] = secret;
  try {
    await axios.post(url, { action: 'analyze_situation', parameters: { context } }, { headers, timeout: 5000 });
  } catch {}
}

async function claimIdempotency(tenant: string, key: string): Promise<boolean> {
  const db = new Firestore();
  const id = key.replace(/[\n\r\t\s\/\\#?%*:\[\]]+/g, '_').slice(0, 150);
  const ref = db.collection('tenants').doc(tenant).collection('idempotency').doc(id);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && (snap.data() as any)?.status === 'DONE') throw new Error('dup');
      tx.set(ref, { status: 'CONSUMING', createdAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    });
    return true;
  } catch (e: any) {
    if (String(e?.message || '').includes('dup')) return false;
    return false;
  }
}

async function markDoneIdempotency(tenant: string, key: string): Promise<void> {
  const db = new Firestore();
  const id = key.replace(/[\n\r\t\s\/\\#?%*:\[\]]+/g, '_').slice(0, 150);
  const ref = db.collection('tenants').doc(tenant).collection('idempotency').doc(id);
  try { await ref.set({ status: 'DONE', updatedAt: Date.now() }, { merge: true }); } catch {}
}

export function taskRoutes(): Router {
  const router = Router();
  const tracer = new CloudTraceService();

  router.post('/tasks/handle', async (req, res) => {
    const tenant = process.env.DEFAULT_TENANT_ID || 'default';
    let payload: any = {};
    let taskSpanId = '';

    try {
      const m = req.body?.message;
      payload = m?.data ? decodeBase64Json(m.data) : (req.body || {});
      const type = String(payload.type || '').trim();
      const idempotencyKey = String(payload.idempotencyKey || '').trim();

      if (!type || !idempotencyKey) {
        return res.status(204).end();
      }

      // Extract parent trace context from payload
      const webhookSpanId = payload.traceContext ? undefined : undefined; // For now, we'll just note it was passed

      // Start task trace linked to webhook
      taskSpanId = tracer.startTaskTrace(
        type as 'gmail_history' | 'calendar_ping',
        webhookSpanId,
        payload
      );

      const claimed = await claimIdempotency(tenant, idempotencyKey);
      if (!claimed) {
        tracer.finishSpan(taskSpanId, { duplicate: true });
        return res.status(204).end();
      }

      try {
        if (type === 'gmail_history') {
          const ctx = `gmail_history ${payload.payload?.emailAddress || ''} ${payload.payload?.historyId || ''}`;

          // Trace the decision analysis call
          const workspaceSpanId = tracer.startWorkspaceTrace('gmail', 'decision_analyze', taskSpanId);
          await callDecisionAnalyze(ctx);
          tracer.finishSpan(workspaceSpanId, { success: true });

          try { Metrics.record('task_gmail_history', 1, { tenant }); } catch {}
        } else if (type === 'calendar_ping') {
          const ctx = `calendar_ping ${payload.payload?.channelId || ''} ${payload.payload?.messageNumber || ''}`;

          // Trace the decision analysis call
          const workspaceSpanId = tracer.startWorkspaceTrace('calendar', 'decision_analyze', taskSpanId);
          await callDecisionAnalyze(ctx);
          tracer.finishSpan(workspaceSpanId, { success: true });

          try { Metrics.record('task_calendar_ping', 1, { tenant }); } catch {}
        }

        await markDoneIdempotency(tenant, idempotencyKey);
        try { Metrics.record('task_success', 1, { tenant }); } catch {}

        tracer.finishSpan(taskSpanId, { success: true });
        return res.status(204).end();
      } catch (e) {
        tracer.finishSpan(taskSpanId, {
          success: false,
          error: e instanceof Error ? e.message : 'Unknown error'
        });
        try { await publishDlq(payload); } catch {}
        try { Metrics.record('task_failure', 1, { tenant }); } catch {}
        return res.status(204).end();
      }
    } catch (error) {
      if (taskSpanId) {
        tracer.finishSpan(taskSpanId, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      try { await publishDlq(payload); } catch {}
      try { Metrics.record('task_failure', 1, { tenant }); } catch {}
      return res.status(204).end();
    }
  });

  return router;
}
