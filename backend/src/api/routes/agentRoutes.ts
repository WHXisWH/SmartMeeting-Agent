import { Router } from 'express';
import { VertexAgentService } from '../../services/VertexAgentService.js';
import { PolicyWeightsService } from '../../services/PolicyWeightsService.js';

export function agentRoutes(agentBrain: any, vertexAgentService: VertexAgentService): Router {
  const router = Router();

  router.post('/start', (req, res) => {
    agentBrain.start();
    res.status(200).json({ message: 'Agent started' });
  });

  router.post('/stop', (req, res) => {
    agentBrain.stop();
    res.status(200).json({ message: 'Agent stopped' });
  });

  router.get('/status', async (req, res) => {
    try {
      const status = await agentBrain.getStatus();
      res.status(200).json(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get agent status', details: message });
    }
  });

  router.get('/metrics', (req, res) => {
    try {
      const metrics = agentBrain.getMetrics();
      res.status(200).json(metrics);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get agent metrics', details: message });
    }
  });

  router.get('/activity-log', async (req, res) => {
    try {
      const logs = await agentBrain.getActivityLog();
      res.status(200).json(logs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get activity log', details: message });
    }
  });

  router.get('/latest-decision', async (req, res) => {
    try {
      const decision = await agentBrain.getLatestDecision();
      res.status(200).json(decision);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Failed to get latest decision', details: message });
    }
  });

  router.get('/suggestions', async (req, res) => {
    try {
      const { query, maxPages, maxResults } = req.query as any;
      const q = typeof query === 'string' && query.trim().length > 0 ? String(query) : 'in:inbox newer_than:14d category:primary -category:(promotions OR social)';
      const perPage = Math.min(50, Math.max(5, Number(maxResults || 10)));
      const pages = Math.min(5, Math.max(1, Number(maxPages || 3)));
      // First try to load stored suggestions from Firestore (preferred source for pipeline)
      try {
        const { Firestore } = await import('@google-cloud/firestore');
        const db = new Firestore();
        const snap = await db.collection('suggestions').orderBy('createdAt', 'desc').limit(50).get();
        const items: any[] = [];
        for (const d of snap.docs) {
          const s: any = d.data();
          items.push({
            id: s.id || d.id,
            proposal: { summary: s.subject || 'Meeting', attendees: s.participants || [], timezone: s.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') },
            confidence: typeof s.confidence === 'number' ? s.confidence : 0.7,
            explanation: s.explanation || 'Pipeline suggestion',
            candidates: Array.isArray(s.candidates) ? s.candidates : []
          });
        }
        if (items.length > 0) return res.json({ items });
      } catch {}
      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      const gmail: any = (svc as any).gmail;
      try { await (svc as any).ensureAuth(); } catch { return res.json({ items: [] }); }
      const items: any[] = [];
      const out: any[] = [];
      let token: string | undefined = undefined;
      for (let i = 0; i < pages; i++) {
        const resp: any = await gmail.users.messages.list({ userId: 'me', q, pageToken: token, maxResults: perPage });
        const msgs = resp.data.messages || [];
        for (const m of msgs) items.push(m.id);
        token = resp.data.nextPageToken || undefined;
        if (!token) break;
      }
      const getOne = async (id: string) => {
        const det = await gmail.users.messages.get({ userId: 'me', id });
        return normalizeForIntent(det.data as any);
      };
      const batch = await Promise.all(items.map(id => getOne(id)));
      const threshold = Math.max(0, Math.min(1, Number(process.env.MEETING_INTENT_THRESHOLD || '0.6')));
      const autoPropThresh = Math.max(0, Math.min(1, Number(process.env.AUTO_PROPOSE_THRESHOLD || '0.8')));
      for (const m of batch) {
        const s = scoreMeetingIntent(m.subject, m.text || m.html || m.snippet || '', { from: m.from, listUnsubscribe: m.listUnsubscribe, precedence: m.precedence });
        if (s.score >= threshold) {
          const attendees = uniqEmails([extractEmail(m.from), ...splitEmails(m.to)]);
          const base: any = {
            id: m.id,
            proposal: {
              summary: m.subject || 'Meeting',
              attendees,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
            },
            confidence: s.score,
            explanation: s.reason
          };
          // Auto-generate candidate slots for high-confidence suggestions with attendees
          if (s.score >= autoPropThresh && attendees.length > 0) {
            try {
              const tz = process.env.DEFAULT_TIMEZONE || base.proposal.timezone || 'UTC';
              const H = Number(process.env.MEETING_PROPOSAL_HORIZON_HOURS || '72');
              const D = Number(process.env.MEETING_DEFAULT_DURATION_MIN || '30');
              const start = new Date();
              const end = new Date(Date.now() + H * 60 * 60 * 1000);
              const calendars = [...new Set([process.env.DEFAULT_USER_EMAIL, ...attendees].filter(Boolean))] as string[];
              const busy = await svc.getFreeBusy(calendars, start, end, tz);
              const stepMin = Math.max(15, Math.min(D, 60));
              const slots: Array<{ start: string; end: string; score: number; timezone?: string }> = [];
              let cur = new Date(start);
              while (cur.getTime() + D * 60 * 1000 <= end.getTime()) {
                const sDate = new Date(cur);
                const eDate = new Date(cur.getTime() + D * 60 * 1000);
                const okAll = calendars.every(id => isFree(busy[id] || [], sDate, eDate));
                if (okAll) slots.push({ start: sDate.toISOString(), end: eDate.toISOString(), score: scoreSlot(sDate, eDate, tz), timezone: tz });
                cur = new Date(cur.getTime() + stepMin * 60 * 1000);
              }
              slots.sort((a, b) => (b.score - a.score) || (a.start.localeCompare(b.start)));
              base.candidates = slots.slice(0, 5).map(x => ({ start: x.start, end: x.end, timezone: tz }));
            } catch {}
          }
          out.push(base);
        }
      }
      out.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      res.json({ items: out.slice(0, 50) });
    } catch (e) {
      res.json({ items: [] });
    }
  });

  router.post('/suggestions/:id/approve', async (req, res) => {
    try {
      const { subject, description, start, end, attendees = [], timezone } = req.body || {};
      const { Firestore } = await import('@google-cloud/firestore');
      const db = new Firestore();
      const sid = req.params.id;
      let usedSubject = subject;
      let usedAtt: string[] = Array.isArray(attendees) ? attendees : [];
      let usedStart = start; let usedEnd = end; let usedTz = timezone;

      if (!usedSubject || !usedStart || !usedEnd || usedAtt.length === 0) {
        const doc = await db.collection('suggestions').doc(sid).get();
        const s: any = doc.exists ? doc.data() : null;
        if (s) {
          usedSubject = usedSubject || s.subject || 'Meeting';
          usedAtt = usedAtt && usedAtt.length ? usedAtt : (Array.isArray(s.participants) ? s.participants : []);
          const idx = Number((s as any)._selectedIdx || 0);
          const c = Array.isArray(s.candidates) ? (s.candidates[idx] || s.candidates[0]) : null;
          usedStart = usedStart || c?.start;
          usedEnd = usedEnd || c?.end;
          usedTz = usedTz || c?.timezone || s.timezone;
        }
      }

      if (!(usedSubject && usedStart && usedEnd && Array.isArray(usedAtt) && usedAtt.length > 0)) {
        return res.status(400).json({ ok: false, error: 'Missing required fields: subject/start/end/attendees' });
      }

      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      const meeting: any = {
        title: usedSubject,
        description: description || '',
        startTime: new Date(usedStart),
        endTime: new Date(usedEnd),
        participants: usedAtt.map((email: string)=>({ email, name: email }))
      };
      const eventId = await svc.createMeeting(meeting);

      try { await db.collection('suggestions').doc(sid).set({ status: 'confirmed', eventId, confirmedAt: Date.now() }, { merge: true }); } catch {}
      try { (await import('../../utils/Metrics.js')).Metrics.record('meeting_created', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}

      // Auto-create agenda doc, attach to event, and notify attendees
      try {
        const { google } = await import('googleapis');
        const auth: any = (svc as any).auth;
        const drive = google.drive({ version: 'v3', auth });
        const docs = google.docs({ version: 'v1', auth: auth as any });
        const calendar = google.calendar({ version: 'v3', auth });

        const name = `Meeting Agenda - ${new Date(usedStart).toISOString().slice(0,16).replace('T',' ')}`;
        const createResp = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
        const docId = createResp.data.id!;
        const agendaText = `Agenda\n\n- Subject: ${usedSubject}\n- Time: ${new Date(usedStart).toLocaleString()} - ${new Date(usedEnd).toLocaleString()}\n- Attendees: ${usedAtt.join(', ')}\n\nTopics:\n1) Review context\n2) Decisions\n3) Action items`;
        await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text: agendaText, location: { index: 1 } } }] } });

        // Attach agenda doc to event
        try {
          const attachments = [{ fileId: docId, title: 'Meeting Agenda (Docs)' }];
          await calendar.events.patch({ calendarId: 'primary', eventId, requestBody: { attachments }, supportsAttachments: true as any });
        } catch {}

        // Optional sharing
        try {
          const shareType = (process.env.DRIVE_SHARE_TYPE || '').toLowerCase();
          const shareRole = (process.env.DRIVE_SHARE_ROLE || 'reader').toLowerCase();
          const shareDomain = process.env.DRIVE_SHARE_DOMAIN || '';
          if (shareType === 'domain' && shareDomain) {
            await drive.permissions.create({ fileId: docId, requestBody: { role: shareRole as any, type: 'domain', domain: shareDomain } as any });
          } else if (shareType === 'anyone') {
            await drive.permissions.create({ fileId: docId, requestBody: { role: shareRole as any, type: 'anyone' } as any });
          }
        } catch {}

        // Notify attendees
        try {
          const link = (await drive.files.get({ fileId: docId, fields: 'webViewLink' })).data.webViewLink || '';
          const html = `
            <p>Meeting has been confirmed.</p>
            <p>会議が確定しました。</p>
            <p><a href=\"${link}\">Agenda (Docs) / アジェンダ（ドキュメント）</a></p>
          `;
          await svc.sendEmail(usedAtt, usedSubject || 'Meeting', html);
        } catch {}

        try { await db.collection('suggestions').doc(sid).set({ agendaDocId: docId }, { merge: true }); } catch {}
      } catch {}

      return res.json({ ok: true, id: sid, approved: true, eventId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.post('/suggestions/:id/reject', async (req, res) => {
    try {
      const { Firestore } = await import('@google-cloud/firestore');
      const db = new Firestore();
      await db.collection('suggestions').doc(String(req.params.id)).set({ status: 'rejected', rejectedAt: Date.now() }, { merge: true });
      res.json({ ok: true, id: req.params.id, rejected: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.get('/offers/by-suggestion/:id', async (req, res) => {
    res.json({ status: 'none' });
  });

  // Approvals (UI compatibility)
  router.post('/approvals/approve', async (_req, res) => {
    res.json({ ok: true, approved: true });
  });
  router.post('/approvals/reject', async (_req, res) => {
    res.json({ ok: true, rejected: true });
  });
  router.post('/approvals/modify', async (req, res) => {
    res.json({ ok: true, modified: true, payload: req.body || {} });
  });

  // Admin-style meeting proposal (optional UI)
  router.post('/meetings/propose', async (req, res) => {
    try {
      const { attendees = [], durationMin, horizonHours, timezone, subject } = req.body || {};
      if (!Array.isArray(attendees) || attendees.length === 0) return res.status(400).json({ error: 'attendees required' });
      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      const auth: any = (svc as any).auth;
      const tz = String(timezone || process.env.DEFAULT_TIMEZONE || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
      const { SchedulingService } = await import('../../services/SchedulingService.js');
      const sched = new SchedulingService();
      const slots = await sched.generateCandidateSlots(auth, attendees, { durationMin, horizonHours, timezone: tz });
      return res.json({ subject: subject || 'Meeting', attendees, timezone: tz, slots });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  // Admin-style meeting confirm (optional UI)
  router.post('/meetings/confirm', async (req, res) => {
    try {
      const { subject, agenda, start, end, timezone, attendees = [], driveFileIds = [], threadId } = req.body || {};
      if (!(subject && start && end && Array.isArray(attendees) && attendees.length > 0)) return res.status(400).json({ error: 'subject/start/end/attendees required' });
      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      try {
        const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
        if (email) await (svc as any).useUser(email);
      } catch {}
      const auth: any = (svc as any).auth;
      const calendar = (await import('googleapis')).google.calendar({ version: 'v3', auth });
      const drive = (await import('googleapis')).google.drive({ version: 'v3', auth });
      const docs = (await import('googleapis')).google.docs({ version: 'v1', auth: auth as any });
      const tz = String(timezone || process.env.DEFAULT_TIMEZONE || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));

      // Create event
      const params: any = {
        calendarId: 'primary',
        requestBody: {
          summary: subject,
          description: agenda ? `Agenda/Summary:\n${agenda}` : undefined,
          start: { dateTime: start, timeZone: tz },
          end: { dateTime: end, timeZone: tz },
          attendees: attendees.map((e: string) => ({ email: e })),
          conferenceData: { createRequest: { requestId: 'sm-admin-' + Date.now() } },
        },
        conferenceDataVersion: 1,
      };
      const created = (await calendar.events.insert(params)).data;

      // Create agenda Doc and attach
      const name = `Meeting Agenda - ${new Date(start).toISOString().slice(0,16).replace('T',' ')}`;
      const createResp = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
      const docId = createResp.data.id!;
      const agendaText = `Agenda\n\n- Purpose: ${subject}\n- Time: ${new Date(start).toLocaleString()} - ${new Date(end).toLocaleString()}\n- Attendees: ${attendees.join(', ')}\n\nTopics:\n1) Review context\n2) Decisions\n3) Action items`;
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text: agendaText, location: { index: 1 } } }] } });

      // Attach files
      const attachments: any[] = [{ fileUrl: (await drive.files.get({ fileId: docId, fields: 'webViewLink' })).data.webViewLink!, title: 'Agenda', mimeType: 'application/vnd.google-apps.document' }];
      for (const fid of (Array.isArray(driveFileIds) ? driveFileIds : [])) {
        try {
          const meta = await drive.files.get({ fileId: String(fid), fields: 'id,name,webViewLink,mimeType' });
          attachments.push({ fileUrl: meta.data.webViewLink!, title: meta.data.name || 'Material', mimeType: meta.data.mimeType || 'application/octet-stream' });
        } catch {}
      }
      try { await calendar.events.patch({ calendarId: 'primary', eventId: created.id!, requestBody: { attachments }, supportsAttachments: true as any }); } catch {}
      await calendar.events.patch({ calendarId: 'primary', eventId: created.id!, requestBody: { description: `${agenda || ''}\n\nAgenda: ${(await drive.files.get({ fileId: docId, fields: 'webViewLink' })).data.webViewLink}` }, sendUpdates: 'all' });

      return res.json({ ok: true, eventId: created.id, agendaDocId: docId });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  });

  function headerValue(headers: any[], name: string): string {
    const h = headers.find((x: any) => String(x?.name || '').toLowerCase() === name.toLowerCase());
    return String(h?.value || '');
  }
  // Enhanced normalization for meeting-intent scoring
  function normalizeForIntent(msg: any): any {
    const headers = Array.isArray(msg?.payload?.headers) ? msg.payload.headers : [];
    const subject = headerValue(headers, 'Subject');
    const from = headerValue(headers, 'From');
    const to = headerValue(headers, 'To');
    const date = headerValue(headers, 'Date') || (msg.internalDate ? new Date(Number(msg.internalDate)).toUTCString() : '');
    const listUnsubscribe = headerValue(headers, 'List-Unsubscribe') || headerValue(headers, 'List-Id');
    const precedence = headerValue(headers, 'Precedence') || headerValue(headers, 'Auto-Submitted');
    const body = extractPayloadBodyPlus(msg?.payload);
    return { id: msg.id, threadId: msg.threadId, subject, from, to, date, listUnsubscribe, precedence, snippet: msg.snippet || '', html: body.html, text: body.text };
  }
  function extractPayloadBodyPlus(payload: any): { html: string | null; text: string | null } {
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
  // Heuristic meeting-intent scoring with negative filters and time cues
  function scoreMeetingIntent(subject: string, text: string, extra?: { from?: string; listUnsubscribe?: string; precedence?: string }): { score: number; reason: string } {
    const s = (subject || '').toLowerCase();
    const t = (text || '').toLowerCase();
    const full = `${subject || ''} ${text || ''}`;
    const from = String(extra?.from || '').toLowerCase();
    const hasJaChars = /[\u3040-\u30FF\u4E00-\u9FAF]/.test(full);

    const posEn = ['meeting','meet','schedule','scheduling','availability','available','timeslot','time slot','time slots','invite','discussion','sync','appointment','interview','catch up','calendar','call','follow up'];
    const posJa = ['会議','ミーティング','打ち合わせ','打合せ','調整','日程','予定','空き','空いている','候補','確認','都合','時間','カレンダー','面談','通話','インタビュー','日取り','同席'];
    const negEn = ['receipt','invoice','statement','newsletter','digest','promotion','sale','unsubscribe','no-reply','noreply','notification','alert','security','verification','password','code','billing','report'];
    const negJa = ['請求','領収','明細','お知らせ','ニュースレター','配信','購読','宣伝','キャンペーン','セール','アンケート','自動送信','確認コード','セキュリティ','通知'];

    const timeHints = [
      /\b(\d{1,2}:\d{2})\b/,
      /\b(\d{1,2})(am|pm)\b/,
      /\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/,
      /\d{1,2}月\d{1,2}日/,
      /今日|明日|明後日|今週|来週|今月|午後|午前/
    ];
    const askHints = [
      /can we/i, /would you be available/i, /are you available/i, /how about/i, /when works/i, /let's/i,
      /ご都合/, /いかが/, /可能でしょうか/, /ご確認の上ご返信/, /日程ご提案/
    ];

    let score = 0.1;
    const reasons: string[] = [];

    const posHits = countHits(s, posEn) + countHits(t, posEn) + (hasJaChars ? countHits(full, posJa) : 0);
    if (posHits > 0) { score += Math.min(0.5, posHits * 0.12); reasons.push('Intent keywords detected'); }

    const timeHitCount = timeHints.reduce((acc, rx) => acc + (rx.test(full) ? 1 : 0), 0);
    if (timeHitCount > 0) { score += Math.min(0.3, timeHitCount * 0.12); reasons.push('Time phrases present'); }

    const askCount = askHints.reduce((acc, rx) => acc + (rx.test(full) ? 1 : 0), 0);
    if (askCount > 0) { score += Math.min(0.25, askCount * 0.15); reasons.push('Direct request to schedule'); }

    if (/[?？]/.test(subject || '')) score += 0.05;

    const negHits = countHits(s, negEn) + countHits(t, negEn) + (hasJaChars ? countHits(full, negJa) : 0);
    if (negHits > 0) { score -= Math.min(0.6, negHits * 0.15); reasons.push('Newsletter/notification patterns'); }

    if (from.includes('noreply') || from.includes('no-reply')) { score -= 0.3; reasons.push('No-reply sender'); }
    if (String(extra?.listUnsubscribe || '').length > 0) { score -= 0.25; reasons.push('List-Unsubscribe header'); }
    if ((extra?.precedence || '').toLowerCase().includes('bulk')) { score -= 0.2; reasons.push('Bulk/auto-submitted'); }
    const linkCount = (text.match(/https?:\/\//g) || []).length + (subject.match(/https?:\/\//g) || []).length;
    if (linkCount >= 5) { score -= 0.2; reasons.push('Many links (newsletter-like)'); }

    score = Math.max(0, Math.min(1, score));
    const reason = reasons.length > 0 ? reasons.slice(0, 3).join('; ') : 'Low intent';
    return { score, reason };
  }
  function countHits(text: string, list: string[]): number {
    let n = 0; const lower = (text || '').toLowerCase();
    for (const k of list) { if (lower.includes(k)) n++; }
    return n;
  }
  function normalize(msg: any): any {
    const headers = Array.isArray(msg?.payload?.headers) ? msg.payload.headers : [];
    const subject = headerValue(headers, 'Subject');
    const from = headerValue(headers, 'From');
    const to = headerValue(headers, 'To');
    const date = headerValue(headers, 'Date') || (msg.internalDate ? new Date(Number(msg.internalDate)).toUTCString() : '');
    const body = extractPayloadBody(msg?.payload);
    return { id: msg.id, threadId: msg.threadId, subject, from, to, date, snippet: msg.snippet || '', html: body.html, text: body.text };
  }
  function extractPayloadBody(payload: any): { html: string | null; text: string | null } {
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
  function scoreIntent(subject: string, text: string): { score: number; reason: string } {
    const s = (subject || '').toLowerCase();
    const t = (text || '').toLowerCase();
    const ja = (subject || '') + ' ' + (text || '');
    const kws = [
      'meeting','meet','schedule','scheduling','availability','time slots','invite','discussion','sync','appointment',
      '会議','打合せ','打ち合わせ','調整','日程','予定','都合','空き','候補','検討','相談','ディスカッション'
    ];
    let hits = 0;
    for (const k of kws) {
      if (/[\u3040-\u30FF\u4E00-\u9FAF]/.test(k)) { if (ja.includes(k)) hits++; }
      else { if (s.includes(k) || t.includes(k)) hits++; }
    }
    const score = Math.min(1, hits / 4);
    const reason = hits > 0 ? 'Detected meeting-intent keywords' : 'Low intent';
    return { score, reason };
  }
  function extractEmail(s: string): string {
    const m = String(s || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0] : '';
  }
  function splitEmails(s: string): string[] {
    return String(s || '').split(/[,;]+/).map(v => extractEmail(v)).filter(Boolean);
  }
  function uniqEmails(arr: string[]): string[] {
    const set = new Set<string>();
    for (const e of arr) if (e) set.add(e.toLowerCase());
    return Array.from(set);
  }

  // Chat endpoint (goes through VertexAgentBrain to enable security thresholds/approvals; fails on error)
  router.post('/chat', async (req, res) => {
    const { message, context, tools } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required' });
    try {
      const result = await vertexAgentService.chat({ message, context, tools });
      return res.status(200).json({ reply: result.response, confidence: result.confidence, toolsUsed: result.toolsUsed, reasoning: result.reasoning, sessionId: result.sessionId });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ error: 'Chat failed', details: messageText });
    }
  });

  // Meeting proposal/confirmation endpoints (lightweight stubs)
  router.post('/meetings/propose', async (req, res) => {
    try {
      const { attendees = [], horizonHours, durationMin, timeZone } = req.body || {};
      const H = Number(horizonHours || process.env.MEETING_PROPOSAL_HORIZON_HOURS || 72);
      const D = Number(durationMin || process.env.MEETING_DEFAULT_DURATION_MIN || 30);
      if (!Array.isArray(attendees) || attendees.length === 0) return res.status(400).json({ error: 'attendees required' });

      // Use GoogleWorkspaceService directly for freebusy
      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      const start = new Date();
      const end = new Date(Date.now() + H * 60 * 60 * 1000);
      const calendars = [...new Set([process.env.DEFAULT_USER_EMAIL, ...attendees].filter(Boolean))] as string[];
      const busy = await svc.getFreeBusy(calendars, start, end, timeZone || process.env.DEFAULT_TIMEZONE || 'UTC');

      // Load policy weights from BigQuery (optional, fallback defaults)
      const policy = await loadPolicyWeightsBQ().catch(() => ({} as any));

      // Build availability grid, naive 30-min steps
      const stepMin = Math.max(15, Math.min(D, 60));
      const slots: Array<{ start: string; end: string; score: number }> = [];
      const tz = timeZone || process.env.DEFAULT_TIMEZONE || 'UTC';
      let cur = new Date(start);
      while (cur.getTime() + D * 60 * 1000 <= end.getTime()) {
        const s = new Date(cur);
        const e = new Date(cur.getTime() + D * 60 * 1000);
        // everyone free?
        const okAll = calendars.every(id => isFree(busy[id] || [], s, e));
        if (okAll) {
          const score = scoreSlot(s, e, tz, policy);
          slots.push({ start: s.toISOString(), end: e.toISOString(), score });
        }
        cur = new Date(cur.getTime() + stepMin * 60 * 1000);
      }
      // sort by score desc then earliest
      slots.sort((a, b) => (b.score - a.score) || (a.start.localeCompare(b.start)));
      res.json({ ok: true, slots: slots.slice(0, 10), horizonHours: H, durationMin: D });

    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/meetings/confirm', async (req, res) => {
    try {
      const { subject, description, start, end, attendees = [] } = req.body || {};
      if (!subject || !start || !end || !Array.isArray(attendees) || attendees.length === 0) return res.status(400).json({ error: 'subject/start/end/attendees required' });

      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      // Create meeting
      const meeting: any = {
        title: subject,
        description: description || '',
        startTime: new Date(start),
        endTime: new Date(end),
        participants: attendees.map((email: string)=>({ email, name: email }))
      };
      const eventId = await svc.createMeeting(meeting);

      // Prepare agenda doc and attach to calendar event
      const { google } = await import('googleapis');
      const auth: any = (svc as any).auth;
      const drive = google.drive({ version: 'v3', auth });
      const docs = google.docs({ version: 'v1', auth: auth as any });
      const name = `Meeting Agenda - ${new Date(start).toISOString().slice(0,16).replace('T',' ')}`;
      const createResp = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
      const docId = createResp.data.id!;
      const agendaText = `Agenda\n\n- Purpose: ${subject}\n- Time: ${new Date(start).toLocaleString()} - ${new Date(end).toLocaleString()}\n- Attendees: ${attendees.join(', ')}\n\nTopics:\n1) Review context\n2) Decisions\n3) Action items`;
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text: agendaText, location: { index: 1 } } }] } });
      const file = await drive.files.get({ fileId: docId, fields: 'id,webViewLink' });

      const calendar = google.calendar({ version: 'v3', auth });
      const attachments = [{ fileUrl: file.data.webViewLink!, title: 'Agenda', mimeType: 'application/vnd.google-apps.document' }];

      // Enhanced material linking for manual schedule
      let attachedMaterials: any[] = [];
      try {
        const { MaterialLinkingService } = await import('../../services/MaterialLinkingService.js');
        const materialService = new MaterialLinkingService();

        const searchContext = {
          subject,
          fromDomain: attendees.length > 0 ? attendees[0].split('@')[1] : undefined,
          participantEmails: attendees,
          eventTimestamp: Date.now()
        };

        const candidates = await materialService.findRelatedMaterials(searchContext, 4);
        const materials = await materialService.prepareMaterialsForEvent(candidates);

        for (const material of materials) {
          attachments.push({
            fileUrl: material.fileUrl,
            title: material.title,
            mimeType: material.mimeType
          });
        }
        attachedMaterials = materials;
      } catch {
        // Fallback to basic search
        try {
          const q = buildDriveQueryFromSubject(subject);
          const search = await drive.files.list({ q, pageSize: 5, fields: 'files(id,name,webViewLink,mimeType,modifiedTime)' });
          for (const f of (search.data.files || [])) {
            attachments.push({ fileUrl: f.webViewLink!, title: f.name || 'Material', mimeType: f.mimeType || 'application/octet-stream' } as any);
            attachedMaterials.push({ id: f.id, title: f.name, fileUrl: f.webViewLink!, mimeType: f.mimeType, matchReasons: ['Basic search'] });
          }
        } catch {}
      }
      try { await calendar.events.patch({ calendarId: 'primary', eventId, requestBody: { attachments }, supportsAttachments: true as any }); } catch {}
      await calendar.events.patch({ calendarId: 'primary', eventId, requestBody: { description: `${description || ''}\n\nAgenda: ${file.data.webViewLink}` }, sendUpdates: 'all' });

      try {
        const { Firestore } = await import('@google-cloud/firestore');
        const db = new Firestore();
        await db.collection('events').doc(String(eventId)).set({
          id: String(eventId),
          subject,
          attendees,
          start,
          end,
          timezone: req.body?.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
          attachedMaterials: attachedMaterials.map(m => ({
            id: m.id,
            title: m.title,
            fileUrl: m.fileUrl,
            mimeType: m.mimeType,
            matchReasons: m.matchReasons || []
          })),
          agendaDocId: docId,
          agendaLink: file.data.webViewLink,
          createdAt: Date.now(),
          source: 'manual-confirm',
          tenant: process.env.DEFAULT_TENANT_ID || 'default'
        }, { merge: true });
      } catch {}
      try { (await import('../../utils/Metrics.js')).Metrics.record('meeting_created', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}

      res.json({ ok: true, scheduled: true, subject, start, end, attendees, eventId, agendaDocId: docId, agendaLink: file.data.webViewLink });

    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/meetings/send-options', async (req, res) => {
    try {
      const { attendees = [], slots = [], subject, suggestionId } = req.body || {};
      if (!Array.isArray(attendees) || attendees.length === 0 || slots.length === 0) return res.status(400).json({ error: 'attendees/slots required' });
      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      const baseUrl = process.env.BACKEND_BASE_URL || process.env.WEBHOOK_BASE_URL || '';
      if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
        return res.status(400).json({ error: 'BACKEND_BASE_URL (or WEBHOOK_BASE_URL) is required to generate confirmation links' });
      }
      const tz = String(req.body?.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
      const links = slots.map((s:any, idx:number) => ({
        idx: idx+1,
        start: s.start,
        end: s.end,
        url: baseUrl ? `${baseUrl}/api/agent/meetings/confirm-link?subject=${encodeURIComponent(subject||'Meeting')}&start=${encodeURIComponent(s.start)}&end=${encodeURIComponent(s.end)}&timezone=${encodeURIComponent(tz)}&attendees=${encodeURIComponent((attendees||[]).join(','))}` : ''
      }));
      const html = `
        <p>Please select a preferred meeting time.</p>
        <p>ご希望の候補時間をお選びください。</p>
        <ul>
          ${links.map((l:any)=>`<li>${l.idx}. ${l.start} - ${l.end}${l.url ? ` — <a href="${l.url}">Confirm / 確定</a>`: ''}</li>`).join('')}
        </ul>
      `;
      await svc.sendEmail(attendees, subject || 'Meeting Options / 候補時間', html);
      try {
        if (suggestionId) {
          const { Firestore } = await import('@google-cloud/firestore');
          const db = new Firestore();
          await db.collection('suggestions').doc(String(suggestionId)).set({ status: 'sent', sentAt: Date.now(), links, candidates: slots }, { merge: true });
        }
      } catch {}
      res.json({ ok: true, sent: true, to: attendees, slotsCount: slots.length, links });
    } catch (e) {
      try {
        const { PubSub } = await import('@google-cloud/pubsub');
        const pubsub = new PubSub();
        await pubsub.topic(process.env.PUBSUB_TOPIC_DLQ || 'sm-tasks-dlq').publishMessage({ json: { type: 'send_options_failure', error: (e as Error).message, at: Date.now() } });
      } catch {}
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // One-click confirmation endpoint used in option emails
  router.get('/meetings/confirm-link', async (req, res) => {
    try {
      const subject = String(req.query.subject || 'Meeting');
      const agenda = String(req.query.agenda || '');
      const start = String(req.query.start || '');
      const end = String(req.query.end || '');
      const timezone = String(req.query.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'));
      const attendees = String(req.query.attendees || '').split(',').map(s=>s.trim()).filter(Boolean);
      const threadId = String(req.query.threadId || '');
      const suggestionId = String(req.query.suggestionId || '');

      const { GoogleWorkspaceService } = await import('../../services/GoogleWorkspaceService.js');
      const svc = new GoogleWorkspaceService();
      const auth: any = (svc as any).auth;
      const calendar = (await import('googleapis')).google.calendar({ version: 'v3', auth });
      const params: any = {
        calendarId: 'primary',
        requestBody: {
          summary: subject,
          description: agenda ? `Agenda/Summary:\n${agenda}` : undefined,
          start: { dateTime: start, timeZone: timezone },
          end: { dateTime: end, timeZone: timezone },
          attendees: attendees.map(e => ({ email: e })),
          conferenceData: { createRequest: { requestId: 'sm-link-' + Date.now() } },
        },
        conferenceDataVersion: 1,
      };
      const created = (await calendar.events.insert(params)).data;
      const meetLink = created.hangoutLink || created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || '';

      // Enhanced material linking with multi-criteria search
      let attachedMaterials: any[] = [];
      try {
        const { MaterialLinkingService } = await import('../../services/MaterialLinkingService.js');
        const materialService = new MaterialLinkingService();

        // Extract sender domain from attendees or use default
        const fromDomain = attendees.length > 0 ? attendees[0].split('@')[1] : undefined;

        const searchContext = {
          subject,
          fromDomain,
          participantEmails: attendees,
          eventTimestamp: Date.now()
        };

        const candidates = await materialService.findRelatedMaterials(searchContext, 5);
        const materials = await materialService.prepareMaterialsForEvent(candidates);

        if (materials.length > 0) {
          const attachments = materials.map(m => ({
            fileUrl: m.fileUrl,
            title: m.title,
            mimeType: m.mimeType
          }));

          await calendar.events.patch({
            calendarId: 'primary',
            eventId: created.id!,
            requestBody: { attachments },
            supportsAttachments: true as any
          });

          attachedMaterials = materials;
        }
      } catch {
        // Fallback to basic search if enhanced search fails
        try {
          const drive = (await import('googleapis')).google.drive({ version: 'v3', auth });
          const q = buildDriveQueryFromSubject(subject);
          const search = await drive.files.list({ q, pageSize: 5, fields: 'files(id,name,webViewLink,mimeType,modifiedTime)' });
          const attachments = (search.data.files || []).map((f:any)=>({ fileUrl: f.webViewLink!, title: f.name || 'Material', mimeType: f.mimeType || 'application/octet-stream' }));
          if (attachments.length) {
            await calendar.events.patch({ calendarId: 'primary', eventId: created.id!, requestBody: { attachments }, supportsAttachments: true as any });
            attachedMaterials = attachments.map((a:any) => ({ ...a, id: '', matchReasons: ['Basic search'] }));
          }
        } catch {}
      }

      // Apply default sharing to attached materials when possible
      try {
        const shareType = (process.env.DRIVE_SHARE_TYPE || '').toLowerCase(); // 'domain' | 'anyone'
        const shareRole = (process.env.DRIVE_SHARE_ROLE || 'reader').toLowerCase();
        const shareDomain = process.env.DRIVE_SHARE_DOMAIN || '';
        const drive = (await import('googleapis')).google.drive({ version: 'v3', auth });
        const parseId = (url: string): string | null => {
          const m = String(url || '').match(/\/d\/([^/]+)/);
          return m && m[1] ? m[1] : null;
        };
        for (const m of attachedMaterials) {
          const id = m.id || parseId(m.fileUrl || '');
          if (!id) continue;
          if (shareType === 'domain' && shareDomain) {
            await drive.permissions.create({ fileId: id, requestBody: { role: shareRole as any, type: 'domain', domain: shareDomain } as any });
          } else if (shareType === 'anyone') {
            await drive.permissions.create({ fileId: id, requestBody: { role: shareRole as any, type: 'anyone' } as any });
          }
        }
      } catch {}
      // Store event record with attached materials for frontend display
      try {
        const { Firestore } = await import('@google-cloud/firestore');
        const db = new Firestore();

        const eventRecord = {
          eventId: created.id,
          subject,
          start,
          end,
          timezone,
          attendees,
          meetLink,
          attachedMaterials: attachedMaterials.map(m => ({
            id: m.id,
            title: m.title,
            fileUrl: m.fileUrl,
            mimeType: m.mimeType,
            matchReasons: m.matchReasons || []
          })),
          createdAt: Date.now(),
          tenant: process.env.DEFAULT_TENANT_ID || 'default'
        };

        await db.collection('events').doc(created.id!).set(eventRecord);

        if (suggestionId) {
          await db.collection('suggestions').doc(suggestionId).set({
            status: 'confirmed',
            eventId: created.id,
            confirmedAt: Date.now(),
            attachedMaterialsCount: attachedMaterials.length
          }, { merge: true });
        }
      } catch {}

      try { (await import('../../utils/Metrics.js')).Metrics.record('meeting_created', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}

      // Notify attendees by email (best-effort)
      try {
        const gmail = (await import('googleapis')).google.gmail({ version: 'v1', auth });
        const html = `<p>Meeting time confirmed: ${subject}</p><p>Time: ${start} ~ ${end} (${timezone})</p>${meetLink ? `<p>Meet: <a href=\"${meetLink}\">${meetLink}</a></p>` : ''}`;
        const rawLines = [ `To: ${attendees.join(',')}`, `Subject: Meeting time confirmed: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html ];
        const raw = Buffer.from(rawLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: threadId || undefined } });
      } catch {}

      res.status(200).send(`<html><body><p>Meeting created for you: ${subject} (${start} ~ ${end} ${timezone}).</p>${meetLink ? `<p>Meet: <a href=\"${meetLink}\">${meetLink}</a></p>` : ''}</body></html>`);
    } catch (e) {
      res.status(500).send(`Confirm failed: ${(e as Error).message}`);
    }
  });

  return router;
}

// Helpers for time windows
function isFree(busy: Array<{ start: string; end: string }>, s: Date, e: Date): boolean {
  const si = s.getTime();
  const ei = e.getTime();
  for (const b of busy) {
    const bs = Date.parse(b.start);
    const be = Date.parse(b.end);
    if (si < be && ei > bs) return false; // overlap
  }
  return true;
}

function scoreSlot(s: Date, e: Date, tz: string, policy?: any): number {
  // Prefer business hours 9-18 local time
  const h = new Date(s.toLocaleString('en-US', { timeZone: tz })).getHours();
  const wBiz = Number((policy && policy.weight_business_hours) ?? 0.4);
  const wPref = Number((policy && policy.weight_preferred_hours) ?? 0.1);
  let score = 0.5;
  if (h >= 9 && h <= 18) score += wBiz;
  if (h === 9 || h === 10 || h === 14) score += wPref;
  return Math.min(1, score);
}

async function loadPolicyWeightsBQ(): Promise<any> {
  try {
    const tenant = process.env.DEFAULT_TENANT_ID || 'default';
    const svc = PolicyWeightsService.getInstance();
    const data = await svc.getPolicyForTenant(tenant);
    return data || {};
  } catch {
    return {};
  }
}
function buildDriveQueryFromSubject(subject: string): string {
  const tokens = String(subject || '').split(/[^A-Za-z0-9_\u3040-\u30FF\u4E00-\u9FAF]+/).filter(t => t && t.length >= 2 && t.length <= 24).slice(0, 4);
  const contains = tokens.map(t => `name contains '${t.replace(/'/g, "\\'")}' or fullText contains '${t.replace(/'/g, "\\'")}'`).join(' or ');
  const dateFilter = `modifiedTime > '${new Date(Date.now() - 90*24*60*60*1000).toISOString()}'`;
  return contains ? `(${contains}) and ${dateFilter} and trashed=false` : `${dateFilter} and trashed=false`;
}
