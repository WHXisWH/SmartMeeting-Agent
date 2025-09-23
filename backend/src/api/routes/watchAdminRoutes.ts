import { Router } from 'express';
import { google } from 'googleapis';
import { GoogleWorkspaceService } from '../../services/GoogleWorkspaceService.js';
import { Firestore } from '@google-cloud/firestore';
import crypto from 'crypto';

// Admin routes to start/stop watches (lightweight). Gmail requires Pub/Sub topic.

export function watchAdminRoutes(): Router {
  const router = Router();

  router.post('/api/admin/watch/start', async (_req, res) => {
    try {
      // Reuse tokens via GoogleWorkspaceService (loads Firestore tokens for DEFAULT_USER_EMAIL)
      const svc = new GoogleWorkspaceService();
      const auth: any = (svc as any).auth;
      // Force load tokens from Firestore for DEFAULT_USER_EMAIL
      const email = process.env.DEFAULT_USER_EMAIL || '';
      if (email) {
        const db = new Firestore();
        const snap = await db.collection('oauth_tokens').doc(email).get();
        const tokens = snap.exists ? (snap.data() as any) : null;
        if (tokens) auth.setCredentials(tokens);
      }
      const calendar = google.calendar({ version: 'v3', auth });
      const base = String(process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');
      const address = base ? `${base}/webhooks/calendar` : '';
      const token = process.env.WEBHOOK_TOKEN || '';
      const id = `cal_${Date.now()}`;
      const calId = `cal_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await calendar.events.watch({
        calendarId: 'primary',
        requestBody: { id: calId, type: 'webhook', address, token }
      } as any);

      try {
        const db = new Firestore();
        const tenant = process.env.DEFAULT_TENANT_ID || 'default';
        await db.collection('tenants').doc(tenant).collection('watch_calendar').doc(calId).set({
          id: calId,
          address,
          token,
          calendarId: 'primary',
          createdAt: Date.now()
        });
      } catch {}

      const gmailTopic = process.env.GMAIL_PUBSUB_TOPIC || '';
      let gmailNote = 'skipped';
      if (gmailTopic) {
        const gmail = google.gmail({ version: 'v1', auth });
        const resp = await gmail.users.watch({ userId: 'me', requestBody: { topicName: gmailTopic, labelIds: ['INBOX'], includeSpamTrash: false } as any });
        gmailNote = 'started';
        try {
          const db = new Firestore();
          const tenant = process.env.DEFAULT_TENANT_ID || 'default';
          await db.collection('tenants').doc(tenant).collection('watch_gmail').doc('me').set({
            userId: 'me',
            topicName: gmailTopic,
            historyId: String(resp.data.historyId || ''),
            expiration: Number(resp.data.expiration || 0),
            updatedAt: Date.now()
          });
        } catch {}
      }

      return res.json({ ok: true, calendar: 'started', gmail: gmailNote });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.post('/admin/watches/renew-gmail', async (_req, res) => {
    try {
      const svc = new GoogleWorkspaceService();
      const auth: any = (svc as any).auth;
      try {
        const email = process.env.DEFAULT_USER_EMAIL || '';
        if (email) {
          const db = new Firestore();
          const snap = await db.collection('oauth_tokens').doc(email).get();
          const tokens = snap.exists ? (snap.data() as any) : null;
          if (tokens) auth.setCredentials(tokens);
        }
      } catch {}
      const gmail = google.gmail({ version: 'v1', auth });
      const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
      const topic = process.env.GMAIL_PUBSUB_TOPIC || `projects/${project}/topics/agent-gmail`;
      const resp = await gmail.users.watch({ userId: 'me', requestBody: { topicName: topic, labelIds: ['INBOX'], includeSpamTrash: false } as any });
      try {
        const db = new Firestore();
        const tenant = process.env.DEFAULT_TENANT_ID || 'default';
        await db.collection('tenants').doc(tenant).collection('watch_gmail').doc('me').set({
          userId: 'me', topicName: topic, historyId: String(resp.data.historyId || ''), expiration: Number(resp.data.expiration || 0), updatedAt: Date.now()
        }, { merge: true });
      } catch {}
      return res.json({ ok: true, renewed: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.post('/admin/watches/renew-calendar', async (_req, res) => {
    try {
      const svc = new GoogleWorkspaceService();
      const auth: any = (svc as any).auth;
      try {
        const email = process.env.DEFAULT_USER_EMAIL || '';
        if (email) {
          const db = new Firestore();
          const snap = await db.collection('oauth_tokens').doc(email).get();
          const tokens = snap.exists ? (snap.data() as any) : null;
          if (tokens) auth.setCredentials(tokens);
        }
      } catch {}
      const calendar = google.calendar({ version: 'v3', auth });
      const base = String(process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');
      const address = base ? `${base}/webhooks/calendar` : '';
      const token = process.env.WEBHOOK_TOKEN || crypto.randomUUID();
      const id = `cal_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await calendar.events.watch({ calendarId: 'primary', requestBody: { id, type: 'webhook', address, token } } as any);
      try {
        const db = new Firestore();
      // Store under the specific user's tenant path as well when possible
      try {
        const email = (process.env.DEFAULT_USER_EMAIL || '').trim();
        if (email) {
          await db.collection('tenants').doc(email).collection('watch_calendar').doc(id).set({ id, email, address, token, calendarId: 'primary', createdAt: Date.now() }, { merge: true });
        }
      } catch {}
      } catch {}
      return res.json({ ok: true, renewed: true, id });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Renew watches for all users that have tokens stored (for Scheduler use)
  router.post('/admin/watches/renew-all', async (_req, res) => {
    try {
      const db = new Firestore();
      const snap = await db.collection('oauth_tokens').get();
      let ok = 0; let fail = 0; const results: any[] = [];
      for (const d of snap.docs) {
        const email = d.id;
        try {
          const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
          const svc = await (GoogleWorkspaceService as any).forUser(email);
          await Promise.all([
            svc.createUserGmailWatch(email).catch(() => {}),
            svc.createUserCalendarWatch(email).catch(() => {})
          ]);
          ok++;
          results.push({ email, ok: true });
        } catch (e) {
          fail++;
          results.push({ email, ok: false, error: (e as Error).message });
        }
      }
      return res.json({ ok: true, renewed: ok, failed: fail, results });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.post('/admin/ttl/cleanup', async (_req, res) => {
    try {
      const db = new Firestore();
      const tenant = process.env.DEFAULT_TENANT_ID || 'default';
      const cutoff = Date.now() - (Number(process.env.IDEMPOTENCY_TTL_MS || 7 * 24 * 60 * 60 * 1000));
      const col = db.collection('tenants').doc(tenant).collection('idempotency');
      const snap = await col.get();
      let deleted = 0;
      for (const d of snap.docs) {
        const u = (d.data() as any)?.updatedAt || 0;
        if (u > 0 && u < cutoff) { try { await d.ref.delete(); deleted++; } catch {} }
      }
      return res.json({ ok: true, deleted });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.post('/api/admin/watch/stop', async (_req, res) => {
    // For simplicity, stopping watches is not implemented here as it requires stored channel IDs.
    return res.json({ ok: true, note: 'Stop is not implemented; recreate watch when needed.' });
  });

  return router;
}
