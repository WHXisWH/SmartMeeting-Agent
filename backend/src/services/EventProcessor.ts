import { google } from 'googleapis';
import axios from 'axios';
import { Logger } from '../utils/Logger.js';
import { EventQueueService, QueueItem } from './EventQueueService.js';
import { GoogleWorkspaceService } from './GoogleWorkspaceService.js';
import { SchedulingService } from './SchedulingService.js';
import { Firestore } from '@google-cloud/firestore';
import { Metrics } from '../utils/Metrics.js';
import { ensureIntent } from '../utils/IntentSchema.js';

export class EventProcessor {
  private logger = new Logger('EventProcessor');
  private queue = new EventQueueService();
  private db = new Firestore();

  async processNext(batch: number = 5): Promise<{ processed: number; failed: number }> {
    const items = await this.queue.leaseNext(batch, 60000);
    let ok = 0, ng = 0;
    for (const it of items) {
      try {
        await this.processItem(it);
        await this.queue.markDone(it.id);
        ok++;
      } catch (e) {
        await this.queue.markFailed(it.id, (e as Error).message);
        ng++;
      }
    }
    return { processed: ok, failed: ng };
  }

  private async processItem(item: QueueItem): Promise<void> {
    switch (item.type) {
      case 'gmail_history':
        return this.handleGmailHistory(item.payload);
      case 'calendar_ping':
        return this.handleCalendarPing(item.payload);
      default:
        this.logger.warn('Unknown queue item type', { type: item.type });
    }
  }

  private async handleGmailHistory(payload: any): Promise<void> {
    const svc = new GoogleWorkspaceService();
    const auth: any = (svc as any).auth;
    const gmail = google.gmail({ version: 'v1', auth });
    const email = String(payload?.emailAddress || 'me');
    const historyId = String(payload?.historyId || '');
    if (!historyId) return;

    // Fetch history changes
    const hist = await gmail.users.history.list({ userId: email, startHistoryId: historyId, historyTypes: ['messageAdded'] });
    const history = hist.data.history || [];
    for (const h of history) {
      for (const m of (h as any).messagesAdded || []) {
        const mid = (m?.message && typeof m.message.id === 'string') ? m.message.id as string : undefined;
        await this.processNewMessage(gmail, email, mid);
      }
    }
  }

  private async processNewMessage(gmail: any, userId: string, messageId?: string): Promise<void> {
    if (!messageId) return;
    const det = await gmail.users.messages.get({ userId, id: messageId, format: 'full' });
    const msg = det.data;
    const headers = msg.payload?.headers || [] as any[];
    const H = (name: string) => (headers as any[]).find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
    const subject = H('Subject') || '(no subject)';
    const from = H('From') || '';
    const to = H('To') || '';
    const cc = H('Cc') || '';
    const participants = this.collectEmails([from, to, cc]);
    const snippet = msg.snippet || '';
    const listUnsub = H('List-Unsubscribe') || H('List-Id') || '';
    const precedence = H('Precedence') || H('Auto-Submitted') || '';
    const isNoReply = /no-?reply/i.test(from);
    const linkCount = (snippet.match(/https?:\/\//g) || []).length + (subject.match(/https?:\/\//g) || []).length;

    // Enrich with thread context (last messages summary)
    let threadSummary: string | null = null;
    if (msg.threadId) {
      try { threadSummary = await this.summarizeThread(gmail, userId, msg.threadId); } catch { threadSummary = null; }
    }

    // Classify meeting intent using Vertex AI (structured JSON)
    const classification = await this.classifyIntent({ subject, snippet, participants, threadSummary, listUnsub, precedence, isNoReply, linkCount }).catch(()=>null) as any;
    try { Metrics.record('intent_classified', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}
    const modelParticipants: string[] = Array.isArray(classification?.participants) ? classification.participants.filter(Boolean) : [];
    const resolvedParticipants = (modelParticipants.length ? modelParticipants : participants).filter(Boolean);
    const score = Number(classification?.intent_score ?? 0);
    const needMeetingFromModel = classification?.need_meeting === true || score >= Number(process.env.MEETING_INTENT_THRESHOLD || '0.6');
    let needMeeting = needMeetingFromModel;
    // Fallback: DecisionTool (if configured) as auxiliary signal
    if (!needMeeting) {
      const cf = process.env.CF_DECISION_URL || '';
      if (cf) {
        try {
          const rsp = await axios.post(cf, { action: 'analyze_situation', parameters: { context: `subject=${subject}; snippet=${snippet}` } }, { timeout: 4000 });
          const urgency = String(rsp.data?.result?.urgencyLevel || 'medium');
          needMeeting = urgency === 'high' || urgency === 'medium';
        } catch {}
      }
    }
    // Final heuristic guardrails
    if (!needMeeting) {
      const neg = /(receipt|invoice|newsletter|digest|unsubscribe|no-reply|noreply|billing|security|verification|password)/i.test(subject + ' ' + snippet);
      const pos = /(meeting|calendar|schedule|availability|appointment|interview|catch up|会議|ミーティング|カレンダー|スケジュール|日程|打ち合わせ)/i.test(subject + ' ' + snippet);
      needMeeting = !neg && pos && participants.length > 1;
    }
    if (!needMeeting) return;

    // Generate candidate slots
    const sched = new SchedulingService();
    const slots = await sched.generateCandidateSlots(gmail._options.auth, resolvedParticipants.filter(e => !e.endsWith('gmail.com') || true));
    if (slots.length === 0) return;

    // Decide auto-send vs store suggestion based on threshold
    const autoThresh = Number(process.env.AUTO_PROPOSE_THRESHOLD || '0.8');
    const explanation = classification?.rationale || 'Model/heuristic signals indicated a meeting is useful.';
    if (score < autoThresh) {
      try {
        const sugId = `sg_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        await this.db.collection('suggestions').doc(sugId).set({
          id: sugId,
          threadId: msg.threadId || null,
          messageId,
          subject,
          participants: resolvedParticipants,
          createdAt: Date.now(),
          timezone: slots[0]?.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
          candidates: slots,
          confidence: score || 0.7,
          explanation,
          status: 'pending'
        } as any, { merge: true });
        try { Metrics.record('suggestion_pending', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}
      } catch {}
      return; // Do not auto-send options when below auto threshold
    }

    // Send options email with one-click confirm links (auto)
    const base = String(process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');
    const tz = slots[0].timezone;
    const links = slots.map((s: any, i: number) => {
      const qs = new URLSearchParams({
        subject,
        agenda: '',
        start: s.start,
        end: s.end,
        timezone: tz,
        attendees: resolvedParticipants.join(','),
        threadId: msg.threadId || ''
      }).toString();
      return { idx: i+1, start: s.start, end: s.end, url: `${base}/api/agent/meetings/confirm-link?${qs}` };
    });

    const html = `
      <p>This thread likely requires a meeting. Here are candidate times:</p>
      <ol>
        ${links.map(l => `<li>${l.start} ~ ${l.end} &nbsp; <a href="${l.url}">One‑click confirm</a></li>`).join('')}
      </ol>
    `;
    const rawLines = [
      `To: ${resolvedParticipants.join(',')}`,
      `Subject: Meeting time options: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
    ];
    const raw = Buffer.from(rawLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: msg.threadId || undefined } });
    try { Metrics.record('suggestion_auto_sent', 1, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}

    // Store offer record for follow-up scan
    try {
      const offerId = 'offer_' + Date.now();
      await this.db.collection('offers').doc(offerId).set({
        offerId,
        subject,
        attendees: resolvedParticipants,
        slots,
        threadId: msg.threadId || null,
        messageId: sent.data.id || null,
        createdAt: Date.now(),
        status: 'sent',
        timezone: tz
      } as any, { merge: true });
      // Store suggestion record for UI/state machine
      const sugId = `sg_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await this.db.collection('suggestions').doc(sugId).set({
        id: sugId,
        threadId: msg.threadId || null,
        messageId,
        subject,
        participants: resolvedParticipants,
        createdAt: Date.now(),
        timezone: tz,
        candidates: slots,
        confidence: score || 0.85,
        explanation,
        status: 'sent',
        offerId,
        links
      } as any, { merge: true });
    } catch {}
  }

  private async classifyIntent(ctx: { subject: string; snippet: string; participants: string[]; threadSummary?: string | null; listUnsub?: string; precedence?: string; isNoReply?: boolean; linkCount?: number }): Promise<any> {
    try {
      const { VertexAI } = await import('@google-cloud/vertexai');
      const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
      const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
      const modelName = process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro';
      const vx = new VertexAI({ project, location });
      const model = vx.getGenerativeModel({ model: modelName });
      const negSignals = `no_reply=${ctx.isNoReply ? 'true' : 'false'}, list_unsubscribe=${Boolean(ctx.listUnsub)}, precedence=${ctx.precedence||''}, link_count=${ctx.linkCount||0}`;
      const prompt = `Decide if an email thread requires a meeting.
Return STRICT JSON with keys: need_meeting (boolean), intent_score (0..1), participants (array of emails), time_hints (array), agenda_hints (array), doc_hints (array), rationale (string).
Consider negative signals: newsletter/digest/no-reply/list-unsubscribe/receipt/invoice. Intent score must reflect these signals.
Subject: ${ctx.subject}
Snippet: ${ctx.snippet}
Participants: ${ctx.participants.join(', ')}
ThreadSummary:
${ctx.threadSummary || '(none)'}
Signals: ${negSignals}
`;
      const resp = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
      const text = resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonStr = (text.match(/\{[\s\S]*\}/) || [text])[0];
      const raw = JSON.parse(jsonStr);
      return ensureIntent(raw, ctx.participants);
    } catch {
      return null;
    }
  }

  private collectEmails(fields: string[]): string[] {
    const set = new Set<string>();
    for (const f of fields) {
      const matches = (f || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
      matches.forEach(e => set.add(e));
    }
    return Array.from(set);
  }

  private async handleCalendarPing(_payload: any): Promise<void> {
    try {
      const svc = new GoogleWorkspaceService();
      const auth: any = (svc as any).auth;
      const calendar = (await import('googleapis')).google.calendar({ version: 'v3', auth });
      const drive = (await import('googleapis')).google.drive({ version: 'v3', auth });
      const gmail = (await import('googleapis')).google.gmail({ version: 'v1', auth });

      const now = new Date();
      const startWindow = new Date(now.getTime() - 30 * 60 * 1000);
      const list = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startWindow.toISOString(),
        timeMax: now.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 10
      });
      const events = list.data.items || [];
      for (const ev of events) {
        const id = ev.id;
        if (!id) continue;
        const ended = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() <= now.getTime() : false;
        if (!ended) continue;
        const markId = `minutes_${id}`;
        const markDoc = await this.db.collection('minutes_generated').doc(markId).get();
        if (markDoc.exists) continue;
        const desc = ev.description || '';
        if (desc.includes('Minutes:')) { await this.db.collection('minutes_generated').doc(markId).set({ createdAt: Date.now(), eventId: id }); continue; }

        // Auto-generate minutes and distribute (enhanced path)
        await this.generateMinutesAndDistribute(auth, ev, calendar, drive, gmail).catch(async () => {
          // Fallback: create minimal minutes doc only
          const title = ev.summary || 'Meeting';
          const attendees = (ev.attendees || []).map((a: any)=>a.email).filter(Boolean);
          const when = ev.start?.dateTime || ev.start?.date || '';
          const minutesText = `Meeting Minutes\n\nTitle: ${title}\nTime: ${when}\nAttendees: ${attendees.join(', ') || 'N/A'}\n\nSummary:\n- \n\nDecisions:\n- \n\nAction Items:\n- \n`;
          const fileName = `Meeting Minutes - ${title}`.slice(0, 120);
          const docId = await svc.createDocument(fileName, minutesText);
          const file = await drive.files.get({ fileId: docId, fields: 'id,webViewLink' });
          const link = file.data.webViewLink || '';
          const newDesc = (desc ? (desc + '\n\n') : '') + `Minutes: ${link}`;
          await calendar.events.patch({ calendarId: 'primary', eventId: id, requestBody: { description: newDesc } });
          if (attendees.length) {
            const html = `<p>Minutes created for: ${title}</p><p><a href="${link}">${link}</a></p>`;
            const rawLines = [ `To: ${attendees.join(',')}`, `Subject: Minutes: ${title}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html ];
            const raw = Buffer.from(rawLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
          }
          await this.db.collection('minutes_generated').doc(markId).set({ createdAt: Date.now(), eventId: id, docId });
        });
      }
    } catch {}
  }

  // Enhanced minutes generation and distribution using event data
  private async generateMinutesAndDistribute(auth: any, ev: any, calendar: any, drive: any, gmail: any): Promise<void> {
    // Build a transcript candidate from event description
    const transcript = String(ev.description || '').trim();
    const title = ev.summary || 'Meeting';
    const attendees = (ev.attendees || []).map((a: any)=>a.email).filter(Boolean);
    const tz = process.env.DEFAULT_TIMEZONE || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

    let minutesText = '';
    let actionItems: Array<{ title: string; ownerEmail?: string; due?: string; notes?: string }> = [];
    try {
      if (transcript.length >= 10) {
        const vx: any = await import('@google-cloud/vertexai').catch(() => null);
        if (vx) {
          const { VertexAI } = vx;
          const client = new VertexAI({ project: process.env.GOOGLE_CLOUD_PROJECT_ID, location: process.env.VERTEX_AI_LOCATION || 'asia-northeast1' });
          const model = client.getGenerativeModel({ model: process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro' });
          const prompt = `Please organize the following meeting transcript into clear English meeting minutes, including:\n1) TL;DR (within three lines)\n2) Key decisions\n3) Action items (person in charge, deadline, leave blank if missing)\n4) Risks and points to be confirmed\nOutput as plain text, using clear titles and lists.\n\nTranscript content:\n${transcript}`;
          const resp = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
          minutesText = resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          try {
            const p2 = `Extract action items from the following transcript and output a JSON array: [{"title":string, "ownerEmail"?:string, "due"?:string, "notes"?:string}].\nText:\n${transcript.slice(0, 6000)}`;
            const r2 = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: p2 }] }] });
            const t2 = r2?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
            const jsonStr = (t2.match(/\[[\s\S]*\]/) || [t2])[0];
            const json = JSON.parse(jsonStr);
            if (Array.isArray(json)) actionItems = json.map((x:any)=>({ title: String(x.title||''), ownerEmail: x.ownerEmail, due: x.due, notes: x.notes }));
          } catch {}
        }
      }
    } catch {}

    if (!minutesText) {
      const when = ev.start?.dateTime || ev.start?.date || '';
      minutesText = `Meeting Minutes\n\nTitle: ${title}\nTime: ${when}\nAttendees: ${attendees.join(', ') || 'N/A'}\n\nSummary:\n- \n\nDecisions:\n- \n\nAction Items:\n- \n`;
    }

    // Create minutes Doc
    const name = `Meeting Minutes ${new Date().toISOString().slice(0,16).replace('T',' ')}`;
    const created = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
    const docId = created.data.id!;
    const docs = (await import('googleapis')).google.docs({ version: 'v1', auth: auth as any });
    await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text: minutesText, location: { index: 1 } } }] } });
    const file = await drive.files.get({ fileId: docId, fields: 'id,webViewLink' });

    // Default sharing for doc
    await this.applyDefaultSharing(drive, docId).catch(()=>{});

    // Optional: Slides (only if transcript provided)
    let slidesLink: string | null = null;
    if (transcript.length >= 10) {
      try {
        const slides = (await import('googleapis')).google.slides({ version: 'v1', auth: auth as any });
        const pres = await slides.presentations.create({ requestBody: { title: `Meeting Slides ${new Date().toISOString().slice(0,10)}` } });
        const pid = pres.data.presentationId!;
        await slides.presentations.batchUpdate({ presentationId: pid, requestBody: { requests: [ { insertText: { objectId: pres.data.slides?.[0]?.objectId!, text: (title || 'Meeting Minutes') + '\n' + new Date().toLocaleString() } } ] } });
        slidesLink = `https://docs.google.com/presentation/d/${pid}/edit`;
        await this.applyDefaultSharing(drive, pid).catch(()=>{});
      } catch {}
    }

    // Action Items: Sheet + Tasks + owner emails
    let sheetLink: string | null = null;
    if (Array.isArray(actionItems) && actionItems.length > 0) {
      try {
        const sheets = (await import('googleapis')).google.sheets({ version: 'v4', auth: auth as any });
        const sh = await sheets.spreadsheets.create({ requestBody: { properties: { title: `Action Items ${new Date().toISOString().slice(0,10)}` } } });
        const sid = sh.data.spreadsheetId!;
        await sheets.spreadsheets.values.update({ spreadsheetId: sid, range: 'A1', valueInputOption: 'RAW', requestBody: { values: [ ['item','ownerEmail','due','notes','createdAt'], ...actionItems.map(ai => [ai.title || '', ai.ownerEmail || '', ai.due || '', ai.notes || '', new Date().toISOString()]) ] } });
        sheetLink = `https://docs.google.com/spreadsheets/d/${sid}/edit`;
        await this.applyDefaultSharing(drive, sid).catch(()=>{});

        const tasks = (await import('googleapis')).google.tasks({ version: 'v1', auth });
        let listId: string | null = null;
        try { const tl = await tasks.tasklists.list({ maxResults: 10 }); const found = (tl.data.items || []).find(l => (l.title || '').toLowerCase() === 'smartmeet action items'); if (found && found.id) listId = found.id; } catch {}
        if (!listId) { try { const createdList = await tasks.tasklists.insert({ requestBody: { title: 'SmartMeet Action Items' } }); listId = createdList.data.id || null; } catch {} }
        if (listId) {
          for (const ai of actionItems) {
            try { await tasks.tasks.insert({ tasklist: listId, requestBody: { title: ai.title || 'Action Item', notes: `${ai.notes || ''}${sheetLink ? `\nSheet: ${sheetLink}` : ''}${file?.data?.webViewLink ? `\nMinutes: ${file.data.webViewLink}` : ''}${ai.ownerEmail ? `\nOwner: ${ai.ownerEmail}` : ''}`, due: ai.due ? new Date(ai.due).toISOString() : undefined } }); } catch {}
          }
        }
        // Notify owners
        const grouped: Record<string, Array<{ title: string; due?: string; notes?: string }>> = {};
        actionItems.forEach(ai => { const owner = (ai.ownerEmail || '').trim(); if (!owner) return; if (!grouped[owner]) grouped[owner] = []; grouped[owner].push({ title: ai.title || 'Action Item', due: ai.due, notes: ai.notes }); });
        for (const owner of Object.keys(grouped)) {
          try {
            const itemsHtml = grouped[owner].map(x => `<li>${x.title}${x.due ? ` (due: ${x.due})` : ''}${x.notes ? ` — ${x.notes}` : ''}</li>`).join('');
            const linksHtml = [ file?.data?.webViewLink ? `<a href=\"${file.data.webViewLink}\">Minutes</a>` : '', sheetLink ? `<a href=\"${sheetLink}\">Action Items</a>` : '' ].filter(Boolean).join(' &nbsp; ');
            const html = `<p>You have new action items from the meeting.</p><ul>${itemsHtml}</ul>${linksHtml ? `<p>${linksHtml}</p>` : ''}`;
            const rawLines = [ `To: ${owner}`, `Subject: New Action Items`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html ];
            const raw = Buffer.from(rawLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
          } catch {}
        }
      } catch {}
    }

    // Attach to event & notify attendees
    try {
      const attachments: any[] = [{ fileId: docId, title: 'Meeting Minutes (Docs)' }];
      if (slidesLink) { const m = slidesLink.match(/\/d\/([^/]+)/); if (m) attachments.push({ fileId: m[1], title: 'Meeting Minutes (Slides)' }); }
      await calendar.events.patch({ calendarId: 'primary', eventId: ev.id!, requestBody: { attachments }, supportsAttachments: true as any });
      const lines: string[] = [ `Meeting Minutes (Docs): ${file.data.webViewLink}` ];
      if (slidesLink) lines.push(`Meeting Minutes (Slides): ${slidesLink}`);
      if (sheetLink) lines.push(`Action Items (Sheet): ${sheetLink}`);
      const linkLine = `\n\n${lines.join('\n')}`;
      const newDesc = (ev.description || '') + linkLine;
      await calendar.events.patch({ calendarId: 'primary', eventId: ev.id!, requestBody: { description: newDesc } });
      const mailTo = attendees.filter(Boolean);
      if (mailTo.length) {
        const extra = [ `<a href=\"${file.data.webViewLink}\">Docs</a>` ];
        if (slidesLink) extra.push(`<a href=\"${slidesLink}\">Slides</a>`);
        if (sheetLink) extra.push(`<a href=\"${sheetLink}\">Action Items</a>`);
        const html = `<p>Meeting minutes have been generated:</p><p>${extra.join(' &nbsp; ')}</p>`;
        const rawLines = [ `To: ${mailTo.join(',')}`, `Subject: Meeting Minutes: ${title}` , 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html ];
        const raw = Buffer.from(rawLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      }
      await this.db.collection('minutes_generated').doc(`minutes_${ev.id}`).set({ createdAt: Date.now(), eventId: ev.id, docId, slidesLink: slidesLink || null, sheetLink: sheetLink || null });
    } catch {}
  }

  private async applyDefaultSharing(drive: any, fileId: string): Promise<void> {
    try {
      const shareType = (process.env.DRIVE_SHARE_TYPE || '').toLowerCase();
      const shareRole = (process.env.DRIVE_SHARE_ROLE || 'reader').toLowerCase();
      const shareDomain = process.env.DRIVE_SHARE_DOMAIN || '';
      if (shareType === 'domain' && shareDomain) {
        await drive.permissions.create({ fileId, requestBody: { role: shareRole as any, type: 'domain', domain: shareDomain } as any });
      } else if (shareType === 'anyone') {
        await drive.permissions.create({ fileId, requestBody: { role: shareRole as any, type: 'anyone' } as any });
      }
    } catch {}
  }

  private async summarizeThread(gmail: any, userId: string, threadId: string): Promise<string> {
    const thr = await gmail.users.threads.get({ userId, id: threadId });
    const msgs = (thr.data.messages || []).slice(-5);
    const lines: string[] = [];
    for (const m of msgs) {
      const hdrs = m.payload?.headers || [];
      const HV = (n: string) => (hdrs as any[]).find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || '';
      const s = HV('Subject');
      const f = HV('From');
      const d = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '';
      lines.push(`- ${d} | ${f} | ${s}`);
    }
    return lines.join('\n');
  }
}
