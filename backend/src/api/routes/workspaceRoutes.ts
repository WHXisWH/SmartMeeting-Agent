import { Router } from 'express';
import { GoogleWorkspaceService } from '../../services/GoogleWorkspaceService.js';
import { google } from 'googleapis';

export function workspaceRoutes(): Router {
  const router = Router();
  const svc = new GoogleWorkspaceService();
  const drive = (svc as any).drive as any;
  const gmail = (svc as any).gmail as any;

  // Per-request user context (optional). If email is provided by client, use that user's tokens.
  async function ensureUserContext(req: any) {
    const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
    if (email) {
      try { await (svc as any).useUser(email); } catch {}
    }
  }

  // Calendar
  router.get('/calendar/events', async (req, res) => {
    try {
      await ensureUserContext(req);
      const { timeMin, timeMax } = req.query as any;
      const items = await svc.getEvents(timeMin ? new Date(timeMin) : undefined, timeMax ? new Date(timeMax) : undefined);
      res.json({ items });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/calendar/events', async (req, res) => {
    try {
      await ensureUserContext(req);
      const { summary, description, start, end, timezone, attendees, createMeet } = req.body || {};
      const meeting = {
        title: summary,
        description,
        startTime: start ? new Date(start) : undefined,
        endTime: end ? new Date(end) : undefined,
        participants: (attendees || []).map((email: string) => ({ email, name: email })),
      } as any;
      const id = await svc.createMeeting(meeting);
      res.json({ id });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Gmail
  router.get('/gmail/messages', async (req, res) => {
    try {
      await ensureUserContext(req);
      const { query, pageToken, maxResults } = req.query as any;
      const list = await gmail.users.messages.list({ userId: 'me', q: query || '', pageToken, maxResults: maxResults ? Number(maxResults) : 10 });
      const items: any[] = [];
      for (const m of list.data.messages || []) {
        const det = await gmail.users.messages.get({ userId: 'me', id: m.id });
        const parsed = normalizeGmailMessage(det.data as any);
        items.push(parsed);
      }
      res.json({ items, nextPageToken: list.data.nextPageToken || null });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.get('/gmail/messages/:id', async (req, res) => {
    try {
      await ensureUserContext(req);
      const id = req.params.id;
      const det = await gmail.users.messages.get({ userId: 'me', id });
      const parsed = normalizeGmailMessage(det.data as any);
      res.json(parsed);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/gmail/messages/send', async (req, res) => {
    try {
      await ensureUserContext(req);
      const { to, cc, bcc, subject, html } = req.body || {};
      if (!to) return res.status(400).json({ error: 'missing to' });
      await svc.sendEmail([to, ...(cc? [cc]: []), ...(bcc? [bcc]: [])].filter(Boolean), subject, html);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Drive
  router.get('/drive/files', async (req, res) => {
    try {
      await ensureUserContext(req);
      const { query } = req.query as any;
      const resp = await drive.files.list({ q: query || '', fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' });
      res.json({ items: resp.data.files || [] });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/drive/files/upload', async (req, res) => {
    try {
      await ensureUserContext(req);
      const { fileName, mimeType, contentBase64 } = req.body || {};
      if (!fileName || !contentBase64) return res.status(400).json({ error: 'missing fileName or content' });
      const buffer = Buffer.from(contentBase64, 'base64');
      const resp = await drive.files.create({ requestBody: { name: fileName }, media: { mimeType: mimeType || 'application/octet-stream', body: Buffer.from(buffer) } });
      res.json({ file: resp.data });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Insights & Knowledge (front-end expects these)
  router.get('/insights/meeting-patterns', async (_req, res) => {
    try {
      const end = new Date();
      const start = new Date(Date.now() - 7*24*60*60*1000);
      const data = await svc.analyzeMeetingPatterns(start, end);
      res.json({ period: { start: start.toISOString(), end: end.toISOString() }, ...data });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Weekly usage insights (BigQuery preferred, Firestore fallback)
  router.get('/insights/usage-weekly', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(31, Number((req.query?.days as string) || 7)));
      const now = new Date();
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const dayStr = (d: Date) => d.toISOString().slice(0,10);
      const startDay = dayStr(start);
      const endDay = dayStr(now);

      let rows: Array<{ day: string; suggestions: number; auto_sent: number; confirmed: number; meetings: number; minutes: number }> = [];
      let source = 'bigquery';
      try {
        const authClient = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
        const project = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
        const bigquery = google.bigquery('v2');
        const query = `SELECT day, SUM(suggestions) AS suggestions, SUM(auto_sent) AS auto_sent, SUM(confirmed) AS confirmed, SUM(meetings) AS meetings, SUM(minutes) AS minutes\nFROM \`${project}.smartmeet_meetings.usage_daily\`\nWHERE day >= @start AND day <= @end\nGROUP BY day ORDER BY day`;
        const resp: any = await bigquery.jobs.query({ projectId: project, requestBody: { query, useLegacySql: false, parameterMode: 'NAMED', queryParameters: [ { name: 'start', parameterType: { type: 'STRING' }, parameterValue: { value: startDay } }, { name: 'end', parameterType: { type: 'STRING' }, parameterValue: { value: endDay } } ] }, auth: authClient as any });
        const schema = resp.data?.schema?.fields || [];
        const toObj = (r: any) => { const o: any = {}; r.f.forEach((c: any, i: number) => { o[schema[i].name] = isNaN(Number(c.v)) ? c.v : Number(c.v); }); return o; };
        rows = (resp.data?.rows || []).map(toObj);
      } catch {
        source = 'firestore';
        const fs = new (await import('@google-cloud/firestore')).Firestore();
        const snap = await fs.collection('usage_daily').get();
        rows = snap.docs.map(d => d.data() as any).filter(r => r.day >= startDay && r.day <= endDay).map(r => ({ day: r.day, suggestions: Number(r.suggestions||0), auto_sent: Number(r.auto_sent||0), confirmed: Number(r.confirmed||0), meetings: Number(r.meetings||0), minutes: Number(r.minutes||0) }));
        rows.sort((a,b)=>a.day.localeCompare(b.day));
      }

      const totals = rows.reduce((acc, r) => ({
        suggestions: acc.suggestions + (r.suggestions||0),
        auto_sent: acc.auto_sent + (r.auto_sent||0),
        confirmed: acc.confirmed + (r.confirmed||0),
        meetings: acc.meetings + (r.meetings||0),
        minutes: acc.minutes + (r.minutes||0)
      }), { suggestions:0, auto_sent:0, confirmed:0, meetings:0, minutes:0 });
      const conversion = totals.suggestions > 0 ? (totals.confirmed / totals.suggestions) : 0;

      res.json({ ok: true, source, period: { start: startDay, end: endDay }, totals, rows, conversion });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.get('/knowledge/list', (_req, res) => {
    res.json({
      items: [
        { title: 'Best practices for cross-time-zone meetings', desc: 'Avoid non-working hours, provide multiple time options, and use automatic time zone conversion.' },
        { title: 'Key points for Google Calendar API integration', desc: 'OAuth scopes, Watch channel renewal, and Webhook signature validation.' },
        { title: 'Meeting agenda template', desc: 'Objective, topics, pre-reading materials, responsible persons, and time allocation.' }
      ]
    });
  });

  // Decision bottlenecks (dashboard expects this endpoint)
  router.get('/insights/decision-bottlenecks', (_req, res) => {
    // Simple static shape compatible with existing front-end
    res.json({
      data: [
        { size: 2, rate: 0.8 },
        { size: 3, rate: 0.72 },
        { size: 4, rate: 0.6 },
        { size: 5, rate: 0.42 },
        { size: 6, rate: 0.3 },
      ]
    });
  });

  router.post('/drive/files/:id/permissions', async (req, res) => {
    try {
      const { id } = req.params;
      const { role = 'reader', type = 'anyone' } = req.body || {};
      await drive.permissions.create({ fileId: id, requestBody: { role, type } });
      const file = await drive.files.get({ fileId: id, fields: 'id,name,mimeType,modifiedTime,webViewLink' });
      res.json({ file: file.data });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  return router;
}

function normalizeGmailMessage(msg: any): any {
  const headers = Array.isArray(msg?.payload?.headers) ? msg.payload.headers : [];
  const h = (name: string) => String(headers.find((x: any) => String(x?.name).toLowerCase() === name.toLowerCase())?.value || '');
  const subject = h('Subject');
  const from = h('From');
  const to = h('To');
  const date = h('Date') || (msg.internalDate ? new Date(Number(msg.internalDate)).toUTCString() : '');
  const { html, text } = extractBody(msg?.payload);
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    from,
    to,
    date,
    snippet: msg.snippet || '',
    html,
    text
  };
}

function extractBody(payload: any): { html: string | null; text: string | null } {
  if (!payload) return { html: null, text: null };
  const parts: any[] = [];
  const stack: any[] = [payload];
  while (stack.length) {
    const p = stack.pop();
    if (!p) continue;
    if (p.mimeType && p.body && p.body.data) parts.push(p);
    if (Array.isArray(p.parts)) for (const c of p.parts) stack.push(c);
  }
  let html: string | null = null;
  let text: string | null = null;
  for (const p of parts) {
    const data = Buffer.from(String(p.body.data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    if (!html && String(p.mimeType).includes('text/html')) html = data;
    if (!text && String(p.mimeType).includes('text/plain')) text = data;
  }
  return { html, text };
}
