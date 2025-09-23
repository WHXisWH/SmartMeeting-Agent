import { Router } from 'express';
import { google } from 'googleapis';
import { GoogleWorkspaceService } from '../../services/GoogleWorkspaceService.js';

export function minutesRoutes(): Router {
  const router = Router();
  const svc = new GoogleWorkspaceService();
  async function ensureUserContext(req: any) {
    const email = String(req.query?.email || req.headers['x-user-email'] || '').trim();
    if (email) {
      try { await (svc as any).useUser(email); } catch {}
    }
  }

  router.post('/agent/minutes/generate', async (req, res) => {
    try {
      await ensureUserContext(req);
      const { transcript, title, output } = req.body || {};
      if (!transcript || typeof transcript !== 'string') return res.status(400).json({ error: 'INVALID_TRANSCRIPT' });

      // Generate minutes and action items via Vertex
      let minutesText = '';
      let actionItems: Array<{ title: string; ownerEmail?: string; due?: string; notes?: string }> = [];
      try {
        const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
        const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
        const modelName = process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro';
        const vx: any = await import('@google-cloud/vertexai').catch(() => null);
        if (!vx) throw new Error('vertexai lib not available');
        const { VertexAI } = vx;
        const client = new VertexAI({ project, location });
        const model = client.getGenerativeModel({ model: modelName });
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
      } catch {
        minutesText = `Meeting Minutes\n\nOriginal Transcript (truncated):\n${String(transcript).slice(0, 4000)}`;
      }

      // Workspace services
      const auth: any = (svc as any).auth;
      const drive = google.drive({ version: 'v3', auth });
      const docs = google.docs({ version: 'v1', auth: auth as any });
      const calendar = google.calendar({ version: 'v3', auth });
      const gmail = google.gmail({ version: 'v1', auth });
      const tasks = google.tasks({ version: 'v1', auth });
      const sheets = google.sheets({ version: 'v4', auth: auth as any });

  // Minutes Doc
  const name = (title && String(title)) || `Meeting Minutes ${new Date().toISOString().slice(0,16).replace('T',' ')}`;
  const createResp = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
  const docId = createResp.data.id!;
  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text: minutesText, location: { index: 1 } } }] } });
  const file = await drive.files.get({ fileId: docId, fields: 'id,webViewLink' });
  // Apply default sharing to minutes doc (optional)
  try {
    const shareType = (process.env.DRIVE_SHARE_TYPE || '').toLowerCase(); // 'domain' | 'anyone'
    const shareRole = (process.env.DRIVE_SHARE_ROLE || 'reader').toLowerCase(); // 'reader' by default
    const shareDomain = process.env.DRIVE_SHARE_DOMAIN || '';
    if (shareType === 'domain' && shareDomain) {
      await drive.permissions.create({ fileId: docId, requestBody: { role: shareRole as any, type: 'domain', domain: shareDomain } as any });
    } else if (shareType === 'anyone') {
      await drive.permissions.create({ fileId: docId, requestBody: { role: shareRole as any, type: 'anyone' } as any });
    }
  } catch {}

      // Optional Slides
      let slidesLink: string | null = null;
      if (!output || (Array.isArray(output) && (output as any).includes('slides')) || output === 'slides' || output === 'both') {
        try {
          const slides = google.slides({ version: 'v1', auth: auth as any });
          const pres = await slides.presentations.create({ requestBody: { title: (title && String(title)) || `Meeting Slides ${new Date().toISOString().slice(0,10)}` } });
          const pid = pres.data.presentationId!;
          await slides.presentations.batchUpdate({ presentationId: pid, requestBody: { requests: [ { insertText: { objectId: pres.data.slides?.[0]?.objectId!, text: (title || 'Meeting Minutes') + '\n' + new Date().toLocaleString() } } ] } });
          slidesLink = `https://docs.google.com/presentation/d/${pid}/edit`;
          // Default sharing for slides
          try {
            const shareType = (process.env.DRIVE_SHARE_TYPE || '').toLowerCase();
            const shareRole = (process.env.DRIVE_SHARE_ROLE || 'reader').toLowerCase();
            const shareDomain = process.env.DRIVE_SHARE_DOMAIN || '';
            if (shareType === 'domain' && shareDomain) {
              await drive.permissions.create({ fileId: pid, requestBody: { role: shareRole as any, type: 'domain', domain: shareDomain } as any });
            } else if (shareType === 'anyone') {
              await drive.permissions.create({ fileId: pid, requestBody: { role: shareRole as any, type: 'anyone' } as any });
            }
          } catch {}
        } catch {} 
      }

      // Action Items Sheet if any
      let sheetLink: string | null = null;
      if (actionItems.length) {
        try {
          const sh = await sheets.spreadsheets.create({ requestBody: { properties: { title: (title && String(title)) || `Action Items ${new Date().toISOString().slice(0,10)}` } } });
          const sid = sh.data.spreadsheetId!;
          await sheets.spreadsheets.values.update({ spreadsheetId: sid, range: 'A1', valueInputOption: 'RAW', requestBody: { values: [ ['item','ownerEmail','due','notes','createdAt'], ...actionItems.map(ai => [ai.title || '', ai.ownerEmail || '', ai.due || '', ai.notes || '', new Date().toISOString()]) ] } });
          sheetLink = `https://docs.google.com/spreadsheets/d/${sid}/edit`;
          // Default sharing for sheet
          try {
            const shareType = (process.env.DRIVE_SHARE_TYPE || '').toLowerCase();
            const shareRole = (process.env.DRIVE_SHARE_ROLE || 'reader').toLowerCase();
            const shareDomain = process.env.DRIVE_SHARE_DOMAIN || '';
            if (shareType === 'domain' && shareDomain) {
              await drive.permissions.create({ fileId: sid, requestBody: { role: shareRole as any, type: 'domain', domain: shareDomain } as any });
            } else if (shareType === 'anyone') {
              await drive.permissions.create({ fileId: sid, requestBody: { role: shareRole as any, type: 'anyone' } as any });
            }
          } catch {}
        } catch {} 
      }

      // Attach to nearest event and notify attendees
      try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        const list = await calendar.events.list({ calendarId: 'primary', timeMin: startOfDay.toISOString(), timeMax: endOfDay.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 50 });
        const items = list.data.items || [];
        let target: any = null;
        for (const ev of items) {
          const s = new Date(ev.start?.dateTime || ev.start?.date || now.toISOString());
          const e = new Date(ev.end?.dateTime || ev.end?.date || now.toISOString());
          if (s <= now && now <= e) { target = ev; break; }
        }
        if (!target) {
          const recent = items.filter(ev => new Date(ev.end?.dateTime || ev.end?.date || now.toISOString()) <= now)
                              .sort((a,b)=> new Date(b.end?.dateTime||b.end?.date||'').getTime()-new Date(a.end?.dateTime||a.end?.date||'').getTime())[0];
          const within3h = recent && (now.getTime() - new Date(recent.end?.dateTime || recent.end?.date || now.toISOString()).getTime() <= 3*60*60*1000);
          target = within3h ? recent : (items[items.length-1] || null);
        }
        if (target && target.id) {
          const lines: string[] = [];
          lines.push(`Meeting Minutes (Docs): ${file.data.webViewLink}`);
          if (slidesLink) lines.push(`Meeting Minutes (Slides): ${slidesLink}`);
          if (sheetLink) lines.push(`Action Items (Sheet): ${sheetLink}`);
          const linkLine = `\n\n${lines.join('\n')}`;
          const newDesc = (target.description || '') + linkLine;
          const attachments: any[] = [{ fileId: docId, title: (title && String(title)) || 'Meeting Minutes (Docs)' }];
          try { if (slidesLink) { const match = slidesLink.match(/\/d\/([^/]+)/); if (match) attachments.push({ fileId: match[1], title: 'Meeting Minutes (Slides)' }); } } catch {}
          try { await calendar.events.patch({ calendarId: 'primary', eventId: target.id, requestBody: { attachments }, supportsAttachments: true as any }); } catch {}
          await calendar.events.patch({ calendarId: 'primary', eventId: target.id, requestBody: { description: newDesc } });
          try {
            const attendees = (target.attendees || []).map((a:any)=>a.email).filter(Boolean);
            if (attendees.length) {
              const extra = [ `<a href=\"${file.data.webViewLink}\">Docs</a>` ];
              if (slidesLink) extra.push(`<a href=\"${slidesLink}\">Slides</a>`);
              if (sheetLink) extra.push(`<a href=\"${sheetLink}\">Action Items</a>`);
              const html = `<p>Meeting minutes have been generated:</p><p>${extra.join(' &nbsp; ')}</p>`;
              const rawLines = [ `To: ${attendees.join(',')}`, `Subject: Meeting Minutes` , 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html ];
              const raw = Buffer.from(rawLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
              await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
            }
          } catch {}
        }
      } catch {}

      // Create Google Tasks for action items and notify owners
      if (actionItems.length) {
        try {
          // Find or create a dedicated task list
          let listId: string | null = null;
          try {
            const tl = await tasks.tasklists.list({ maxResults: 10 });
            const found = (tl.data.items || []).find(l => (l.title || '').toLowerCase() === 'smartmeet action items');
            if (found && found.id) listId = found.id;
          } catch {}
          if (!listId) {
            try {
              const created = await tasks.tasklists.insert({ requestBody: { title: 'SmartMeet Action Items' } });
              listId = created.data.id || null;
            } catch {}
          }
          if (listId) {
            for (const ai of actionItems) {
              try {
                const dueIso = ai.due ? new Date(ai.due).toISOString() : undefined;
                await tasks.tasks.insert({ tasklist: listId, requestBody: { title: ai.title || 'Action Item', notes: `${ai.notes || ''}${sheetLink ? `\nSheet: ${sheetLink}` : ''}${file?.data?.webViewLink ? `\nMinutes: ${file.data.webViewLink}` : ''}${ai.ownerEmail ? `\nOwner: ${ai.ownerEmail}` : ''}`, due: dueIso } });
              } catch {}
            }
          }
          // Notify owners via email (grouped per owner)
          const grouped: Record<string, Array<{ title: string; due?: string; notes?: string }>> = {};
          for (const ai of actionItems) {
            const owner = (ai.ownerEmail || '').trim();
            if (!owner) continue;
            if (!grouped[owner]) grouped[owner] = [];
            grouped[owner].push({ title: ai.title || 'Action Item', due: ai.due, notes: ai.notes });
          }
          const owners = Object.keys(grouped);
          for (const owner of owners) {
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

      return res.json({ ok: true, docId, docLink: file.data.webViewLink, slidesLink, sheetLink, actionItemsCount: actionItems.length });
    } catch (e) {
      return res.status(500).json({ error: 'MINUTES_GEN_ERROR', details: (e as Error).message });
    }
  });

  return router;
}
