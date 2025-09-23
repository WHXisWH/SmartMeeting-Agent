import { Router } from 'express';
import axios from 'axios';
import { Metrics } from '../../utils/Metrics.js';
import { IdempotencyService } from '../../services/IdempotencyService.js';
import { CloudTraceService } from '../../services/CloudTraceService.js';
import { PubSub } from '@google-cloud/pubsub';

// Webhooks for Gmail Push (Pub/Sub) and Calendar Watch (webhook)
// JA/EN comments only, no Chinese in code.

export function webhookRoutes(): Router {
  const router = Router();
  const idem = new IdempotencyService();
  const pubsub = new PubSub();
  const tracer = new CloudTraceService();

  // Gmail Push via Pub/Sub HTTP push
  router.post('/webhooks/gmail-push', async (req, res) => {
    const message = req.body?.message;
    const pubsubMessageId = message?.messageId as string | undefined;
    const requestId = req.headers['x-request-id'] as string || pubsubMessageId || 'unknown';

    // Start webhook trace
    const webhookSpanId = tracer.startWebhookTrace('gmail', requestId, req.body);

    try {
      // Idempotency by Pub/Sub messageId if present
      if (pubsubMessageId) {
        const seen = await idem.markPubSubProcessed(pubsubMessageId).catch(()=>true);
        if (seen) {
          tracer.finishSpan(webhookSpanId, { duplicate: true });
          return res.status(204).end();
        }
      }

      const dataBase64 = message?.data;
      const dataStr = dataBase64 ? Buffer.from(dataBase64, 'base64').toString('utf-8') : '';
      const payload = dataStr ? JSON.parse(dataStr) : {};

      // Gmail push payload: { emailAddress, historyId }
      const emailAddress = payload?.emailAddress as string | undefined;
      const historyId = payload?.historyId ? String(payload.historyId) : undefined;

      tracer.addSpanAttributes(webhookSpanId, {
        'gmail.email_address': emailAddress || 'unknown',
        'gmail.history_id': historyId || 'unknown'
      });

      if (emailAddress && historyId) {
        const seenGmail = await idem.markGmailHistoryProcessed(emailAddress, historyId).catch(()=>true);
        if (seenGmail) {
          tracer.finishSpan(webhookSpanId, { duplicate: true, gmail_duplicate: true });
          return res.status(204).end();
        }
      }

      const context = `Gmail push received: ${JSON.stringify({ payloadSummary: Object.keys(payload) })}`;
      await callDecisionAnalyze(context);
      try { Metrics.record('event_gmail_push', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}

      if (emailAddress && historyId) {
        const topic = process.env.PUBSUB_TOPIC_TASKS || 'sm-tasks';
        const msg = {
          type: 'gmail_history',
          id: `${emailAddress}:${historyId}`,
          tenantId: process.env.DEFAULT_TENANT_ID || 'default',
          userId: emailAddress,
          idempotencyKey: `gmail:${emailAddress}:${historyId}#push`,
          payload: { emailAddress, historyId },
          timestamp: new Date().toISOString(),
          traceContext: tracer.getTraceContext(webhookSpanId) // Pass trace context to task
        };
        try { await pubsub.topic(topic).publishMessage({ json: msg }); } catch {}
        tracer.addSpanAttributes(webhookSpanId, { task_published: true });
      }

      tracer.finishSpan(webhookSpanId, { success: true });
      res.status(204).end();
    } catch (error) {
      tracer.finishSpan(webhookSpanId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Record failure for compensation
      try { await idem.recordFailure('gmail_push', { body: req.body }, (error as Error).message); } catch {}
      res.status(500).json({ ok: false, error: 'webhook processing failed' });
    }
  });

  // Calendar Watch webhook
  router.post('/webhooks/calendar', async (req, res) => {
    const channelId = String(req.headers['x-goog-channel-id'] || '');
    const messageNumber = String(req.headers['x-goog-message-number'] || '');
    const requestId = `${channelId}:${messageNumber}`;

    // Start calendar webhook trace
    const webhookSpanId = tracer.startWebhookTrace('calendar', requestId, {
      channelId,
      messageNumber,
      resourceState: req.headers['x-goog-resource-state']
    });

    try {
      const token = req.headers['x-goog-channel-token'];
      const expected = process.env.WEBHOOK_TOKEN || '';
      if (expected && token !== expected) {
        tracer.finishSpan(webhookSpanId, { auth_failed: true });
        return res.status(403).json({ error: 'invalid token' });
      }

      const resourceState = String(req.headers['x-goog-resource-state'] || '');

      tracer.addSpanAttributes(webhookSpanId, {
        'calendar.channel_id': channelId,
        'calendar.message_number': messageNumber,
        'calendar.resource_state': resourceState
      });

      // Idempotency: message-number is monotonically increasing per channel
      if (channelId && messageNumber) {
        const seen = await idem.markCalendarMessageProcessed(channelId, messageNumber).catch(()=>true);
        if (seen) {
          tracer.finishSpan(webhookSpanId, { duplicate: true });
          return res.status(200).json({ ok: true, dedup: true });
        }
      }

      const summary = {
        state: resourceState,
        resourceId: req.headers['x-goog-resource-id'] || '',
        messageNumber: req.headers['x-goog-message-number'] || '',
      };
      const context = `Calendar watch: ${JSON.stringify(summary)}`;
      await callDecisionAnalyze(context);
      try { Metrics.record('event_calendar_watch', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}

      if (channelId && messageNumber) {
        const topic = process.env.PUBSUB_TOPIC_TASKS || 'sm-tasks';
        const msg: any = {
          type: 'calendar_ping',
          id: `${channelId}:${messageNumber}`,
          tenantId: process.env.DEFAULT_TENANT_ID || 'default',
          idempotencyKey: `calendar:${channelId}:${messageNumber}#watch`,
          payload: { channelId, messageNumber },
          timestamp: new Date().toISOString(),
          traceContext: tracer.getTraceContext(webhookSpanId)
        };
        // Resolve userId via tenants/{email}/watch_calendar/{channelId}
        try {
          const { Firestore } = await import('@google-cloud/firestore');
          const db = new Firestore();
          // We stored docId = channelId under tenants/{email}/watch_calendar. Search across tenants by collection group.
          const snap = await db.collectionGroup('watch_calendar').where('id', '==', channelId).get();
          const first = snap.docs[0];
          const email = first?.data()?.email as string | undefined;
          if (email) msg.userId = email;
        } catch {}
        try { await pubsub.topic(topic).publishMessage({ json: msg }); } catch {}
        tracer.addSpanAttributes(webhookSpanId, { task_published: true });
      }

      tracer.finishSpan(webhookSpanId, { success: true });
      return res.status(200).json({ ok: true });
    } catch (error) {
      tracer.finishSpan(webhookSpanId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      try { await idem.recordFailure('calendar_watch', { headers: req.headers }, (error as Error).message); } catch {}
      return res.status(200).json({ ok: false, error: (error as Error).message });
    }
  });

  return router;
}

async function callDecisionAnalyze(context: string) {
  const url = process.env.CF_DECISION_URL || '';
  if (!url) return;
  const headers: any = { 'Content-Type': 'application/json' };
  const secret = process.env.SM_SHARED_SECRET || '';
  if (secret) headers['X-Shared-Secret'] = secret;
  try {
    await axios.post(url, { action: 'analyze_situation', parameters: { context } }, { headers, timeout: 5000 });
  } catch {
    // Swallow errors, webhook must be fast
  }
}
