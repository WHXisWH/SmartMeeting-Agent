import { Router } from 'express';
import { EventProcessor } from '../../services/EventProcessor.js';
import { GoogleWorkspaceService } from '../../services/GoogleWorkspaceService.js';
import { google } from 'googleapis';

function assertInternal(req: any, res: any): boolean {
  const token = req.headers['x-internal-token'] || req.headers['x-internal-jobs-token'];
  const expected = process.env.INTERNAL_JOBS_TOKEN || '';
  if (!expected || token !== expected) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return false;
  }
  return true;
}

export function jobsRoutes(): Router {
  const router = Router();
  const processor = new EventProcessor();

  // Process queued events (Gmail history / Calendar pings)
  router.post('/internal/jobs/process-events', async (req, res) => {
    if (!assertInternal(req, res)) return;
    try {
      const result = await processor.processNext(10);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Scan offer threads for 1/2/3 replies and auto-confirm
  router.post('/internal/jobs/offers-reply-scan', async (req, res) => {
    if (!assertInternal(req, res)) return;
    try {
      const svc = new GoogleWorkspaceService();
      const auth: any = (svc as any).auth;
      const gmail = google.gmail({ version: 'v1', auth });
      const calendar = google.calendar({ version: 'v3', auth });
      const db = new (await import('@google-cloud/firestore')).Firestore();
      const snap = await db.collection('offers').where('status','==','sent').limit(20).get();
      let updated = 0;
      for (const d of snap.docs) {
        const offer: any = d.data();
        if (!offer.threadId) continue;
        const thr = await gmail.users.threads.get({ userId: 'me', id: offer.threadId });
        const msgs = thr.data.messages || [];
        const replies = msgs.filter(m => Number(m.internalDate || '0') >= (offer.createdAt - 10000));
        let picked: number | null = null;
        for (const m of replies) {
          const body = m.snippet || '';
          const match = body.match(/(?:^|\s)([123])(?!\d)/);
          if (match) { picked = Number(match[1]) - 1; break; }
        }
        if (picked === null) continue;
        const idx = Math.max(0, Math.min((offer.slots?.length||1)-1, picked));
        const slot = offer.slots[idx];
        const params: any = {
          calendarId: 'primary',
          requestBody: {
            summary: offer.subject || 'Meeting',
            start: { dateTime: slot.start, timeZone: slot.timezone || offer.timezone || 'UTC' },
            end: { dateTime: slot.end, timeZone: slot.timezone || offer.timezone || 'UTC' },
            attendees: (offer.attendees||[]).map((e:string)=>({ email: e })),
            conferenceData: { createRequest: { requestId: 'sm-offer-' + Date.now() } },
          },
          conferenceDataVersion: 1,
        };
        const created = (await calendar.events.insert(params)).data;
        await d.ref.set({ status: 'confirmed', selectedIndex: idx, eventId: created.id, confirmedAt: Date.now() }, { merge: true });
        updated++;
      }
      res.json({ ok: true, updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Daily rollup: suggestions/meetings/minutes in last 24h -> BigQuery (preferred) or Firestore fallback
  router.post('/internal/jobs/rollup-daily', async (req, res) => {
    if (!assertInternal(req, res)) return;
    try {
      const db = new (await import('@google-cloud/firestore')).Firestore();
      const since = Date.now() - 24*60*60*1000;
      const tenant = process.env.DEFAULT_TENANT_ID || 'default';

      const qSug = await db.collection('suggestions').where('createdAt','>=', since).get();
      let suggestions = qSug.size;
      let autoSent = 0; let confirmed = 0;
      qSug.docs.forEach(d => { const s:any=d.data(); if (s.status==='sent') autoSent++; if (s.status==='confirmed') confirmed++; });

      const qEvt = await db.collection('events').where('createdAt','>=', since).get();
      const meetings = qEvt.size;

      const qMin = await db.collection('minutes_generated').where('createdAt','>=', since).get().catch(()=>({size:0} as any));
      const minutes = qMin.size || 0;

      const day = new Date().toISOString().slice(0,10);
      const row = { day, suggestions, auto_sent: autoSent, confirmed, meetings, minutes, tenant, createdAt: Date.now() } as any;

      // Try BigQuery first
      let target = 'bigquery';
      try {
        const { google } = await import('googleapis');
        const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
        const project = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
        const bigquery = google.bigquery('v2');
        const dataset = 'smartmeet_meetings';
        const table = 'usage_daily';
        await bigquery.tabledata.insertAll({
          projectId: project,
          datasetId: dataset,
          tableId: table,
          requestBody: { rows: [{ json: row }] },
          auth
        } as any);
      } catch (e) {
        target = 'firestore';
        await db.collection('usage_daily').doc(`${day}_${Date.now()}`).set(row);
      }
      res.json({ ok: true, target, row });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Suggestions maintenance: expire pending older than TTL hours
  router.post('/internal/jobs/suggestions-maintenance', async (req, res) => {
    if (!assertInternal(req, res)) return;
    try {
      const ttlHours = Number(process.env.SUGGESTION_TTL_HOURS || '72');
      const cutoff = Date.now() - ttlHours*60*60*1000;
      const db = new (await import('@google-cloud/firestore')).Firestore();
      const snap = await db.collection('suggestions').where('createdAt','<',cutoff).where('status','==','pending').limit(200).get();
      let updated = 0;
      for (const d of snap.docs) { await d.ref.set({ status: 'expired', expiredAt: Date.now() }, { merge: true }); updated++; }
      res.json({ ok: true, expired: updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Auto-generate minutes for recently ended meetings per user
  router.post('/internal/jobs/auto-minutes', async (_req, res) => {
    try {
      const { Firestore } = await import('@google-cloud/firestore');
      const db = new Firestore();
      const snap = await db.collection('oauth_tokens').get();
      const now = new Date();
      const windowMs = Number(process.env.AUTO_MINUTES_LOOKBACK_MS || (2 * 60 * 60 * 1000));
      const timeMin = new Date(now.getTime() - windowMs);
      let processed = 0; let skipped = 0; const results: any[] = [];

      for (const d of snap.docs) {
        const email = d.id;
        try {
          const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
          const svc = await (GoogleWorkspaceService as any).forUser(email);
          const { google } = await import('googleapis');
          const auth: any = (svc as any).auth;
          const calendar = google.calendar({ version: 'v3', auth });
          const drive = google.drive({ version: 'v3', auth });
          const docs = google.docs({ version: 'v1', auth: auth as any });

          const list = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: now.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 50,
          });

          const items = (list.data.items || []).filter(ev => {
            const endIso = ev.end?.dateTime || ev.end?.date;
            if (!endIso) return false;
            const end = new Date(endIso);
            return end.getTime() <= now.getTime() && end.getTime() >= timeMin.getTime();
          });

          for (const ev of items) {
            try {
              const evId = ev.id!;
              const markRef = db.collection('tenants').doc(email).collection('auto_minutes').doc(evId);
              const exists = (await markRef.get()).exists;
              if (exists) { skipped++; continue; }

              const subject = ev.summary || 'Meeting';
              const startIso = ev.start?.dateTime || ev.start?.date || '';
              const endIso = ev.end?.dateTime || ev.end?.date || '';
              const attendees = (ev.attendees || []).map((a:any)=>a.email).filter(Boolean);

              const name = `Meeting Minutes - ${new Date(startIso || Date.now()).toISOString().slice(0,16).replace('T',' ')}`;
              const createResp = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
              const docId = createResp.data.id!;
              const minutesText = `Meeting Minutes\n\n- Subject: ${subject}\n- Time: ${new Date(startIso).toLocaleString()} - ${new Date(endIso).toLocaleString()}\n- Attendees: ${attendees.join(', ')}\n\nSummary:\n- (Auto-generated placeholder)\n\nDecisions:\n- \n\nAction Items:\n- `;
              await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text: minutesText, location: { index: 1 } } }] } });

              // Attach to event
              try {
                const attachments = [{ fileId: docId, title: 'Meeting Minutes (Docs)' }];
                await calendar.events.patch({ calendarId: 'primary', eventId: evId, requestBody: { attachments }, supportsAttachments: true as any });
              } catch {}

              // Notify attendees
              try {
                const link = (await drive.files.get({ fileId: docId, fields: 'webViewLink' })).data.webViewLink || '';
                const html = `<p>Meeting minutes are ready.</p><p><a href=\"${link}\">Minutes (Docs)</a></p>`;
                await svc.sendEmail(attendees, `Minutes: ${subject}`, html);
              } catch {}

              // Mark done
              try { await markRef.set({ email, eventId: evId, docId, createdAt: Date.now() }, { merge: true }); } catch {}
              processed++;
              results.push({ email, eventId: evId, docId });
            } catch (e) {
              results.push({ email, eventId: (e as any)?.eventId || '', error: (e as Error).message });
            }
          }
        } catch (e) {
          results.push({ email, error: (e as Error).message });
        }
      }

      return res.json({ ok: true, processed, skipped, lookbackMs: windowMs, results });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Weekly report generator: aggregates last N days (default 7) and creates a Google Doc
  router.post('/internal/jobs/weekly-report', async (req, res) => {
    if (!assertInternal(req, res)) return;
    try {
      const days = Math.max(1, Math.min(31, Number(req.body?.days || 7)));
      const now = new Date();
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const dayStr = (d: Date) => d.toISOString().slice(0,10);
      const startDay = dayStr(start);
      const endDay = dayStr(now);

      // Load rollup from BigQuery, fallback to Firestore if needed
      let rows: Array<{ day: string; suggestions: number; auto_sent: number; confirmed: number; meetings: number; minutes: number }>= [];
      let source = 'bigquery';
      try {
        const { google } = await import('googleapis');
        const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
        const project = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
        const bigquery = google.bigquery('v2');
        const query = `SELECT day, SUM(suggestions) AS suggestions, SUM(auto_sent) AS auto_sent, SUM(confirmed) AS confirmed, SUM(meetings) AS meetings, SUM(minutes) AS minutes\nFROM \`${project}.smartmeet_meetings.usage_daily\`\nWHERE day >= @start AND day <= @end\nGROUP BY day ORDER BY day`;
        const resp: any = await bigquery.jobs.query({ projectId: project, requestBody: { query, useLegacySql: false, parameterMode: 'NAMED', queryParameters: [ { name: 'start', parameterType: { type: 'STRING' }, parameterValue: { value: startDay } }, { name: 'end', parameterType: { type: 'STRING' }, parameterValue: { value: endDay } } ] }, auth });
        const schema = resp.data?.schema?.fields || [];
        const toObj = (r: any) => {
          const o: any = {}; r.f.forEach((c: any, i: number) => { o[schema[i].name] = isNaN(Number(c.v)) ? c.v : Number(c.v); }); return o;
        };
        rows = (resp.data?.rows || []).map(toObj);
      } catch {
        source = 'firestore';
        const db = new (await import('@google-cloud/firestore')).Firestore();
        // read all docs and filter in memory for simplicity (volume is small)
        const snap = await db.collection('usage_daily').get();
        rows = snap.docs.map(d => d.data() as any).filter(r => r.day >= startDay && r.day <= endDay).map(r => ({ day: r.day, suggestions: Number(r.suggestions||0), auto_sent: Number(r.auto_sent||0), confirmed: Number(r.confirmed||0), meetings: Number(r.meetings||0), minutes: Number(r.minutes||0) }));
        rows.sort((a,b)=>a.day.localeCompare(b.day));
      }

      // Compute totals
      const totals = rows.reduce((acc, r) => ({
        suggestions: acc.suggestions + (r.suggestions||0),
        auto_sent: acc.auto_sent + (r.auto_sent||0),
        confirmed: acc.confirmed + (r.confirmed||0),
        meetings: acc.meetings + (r.meetings||0),
        minutes: acc.minutes + (r.minutes||0)
      }), { suggestions:0, auto_sent:0, confirmed:0, meetings:0, minutes:0 });
      const conv = totals.suggestions > 0 ? (totals.confirmed / totals.suggestions) : 0;

      // Create Google Doc report
      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const { google } = await import('googleapis');
      const svc = new GoogleWorkspaceService();
      const auth: any = (svc as any).auth;
      const drive = google.drive({ version: 'v3', auth });
      const docs = google.docs({ version: 'v1', auth: auth as any });
      const title = `SmartMeet Weekly Report ${startDay} ~ ${endDay}`;
      const created = await drive.files.create({ requestBody: { name: title, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
      const docId = created.data.id!;
      const lines: string[] = [];
      lines.push(`# ${title}`);
      lines.push('');
      lines.push(`Source: ${source}`);
      lines.push('');
      lines.push(`Totals: suggestions=${totals.suggestions}, auto_sent=${totals.auto_sent}, confirmed=${totals.confirmed}, meetings=${totals.meetings}, minutes=${totals.minutes}, conversion=${(conv*100).toFixed(1)}%`);
      lines.push('');
      lines.push('Daily breakdown:');
      rows.forEach(r => { lines.push(`- ${r.day}: sug=${r.suggestions}, sent=${r.auto_sent}, conf=${r.confirmed}, mtg=${r.meetings}, min=${r.minutes}`); });
      const text = lines.join('\n');
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text, location: { index: 1 } } }] } });
      const file = await drive.files.get({ fileId: docId, fields: 'id,webViewLink' });

      res.json({ ok: true, docId, link: file.data.webViewLink, totals, rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
