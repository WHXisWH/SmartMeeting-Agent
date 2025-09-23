import { Router } from 'express';
import { SpeechClient } from '@google-cloud/speech';
import { google } from 'googleapis';
import { GoogleWorkspaceService } from '../../services/GoogleWorkspaceService.js';
import { Metrics } from '../../utils/Metrics.js';

export function speechRoutes(): Router {
  const router = Router();
  const svc = new GoogleWorkspaceService();

  // Synchronous speech recognition for short audio (contentBase64: string, languageCode?: string)
  router.post('/speech/transcribe', async (req, res) => {
    try {
      const contentBase64 = (req.body?.contentBase64 as string) || '';
      const languageCode = (req.body?.languageCode as string) || 'en-US';
      if (!contentBase64) return res.status(400).json({ error: 'NO_CONTENT' });
      const audio = { content: contentBase64 };
      const config: any = { languageCode };
      const client = new SpeechClient();
      const [resp] = await client.recognize({ audio, config });
      const transcript = (resp.results || []).map((r: any) => r.alternatives?.[0]?.transcript || '').join('\n');
      res.json({ ok: true, transcript });
    } catch (e) {
      res.status(500).json({ error: 'SPEECH_ERROR', details: (e as Error).message });
    }
  });

  // Generate meeting minutes from transcript and backfill (Docs/Slides/Sheet + email back)
  router.post('/agent/minutes/generate', async (req, res) => {
    try {
      const { transcript, title, output } = req.body || {};
      if (!transcript || typeof transcript !== 'string') return res.status(400).json({ error: 'INVALID_TRANSCRIPT' });

      // Generate minutes with Vertex
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
          const json = JSON.parse((t2.match(/[\[\]]/) || [t2])[0]);
          if (Array.isArray(json)) actionItems = json.map((x:any)=>({ title: String(x.title||''), ownerEmail: x.ownerEmail, due: x.due, notes: x.notes }));
        } catch {} 
      } catch {
        minutesText = `Meeting Minutes\n\nOriginal Transcript (truncated):\n${transcript.slice(0, 4000)}`;
      }

      // Use Workspace API to write to Docs/Slides/Sheets and try to backfill to the day's event
      const auth: any = (svc as any).auth;
      const drive = google.drive({ version: 'v3', auth });
      const docs = google.docs({ version: 'v1', auth: auth as any });
      const calendar = google.calendar({ version: 'v3', auth });
      const gmail = google.gmail({ version: 'v1', auth });

      const name = (title && String(title)) || `Meeting Minutes ${new Date().toISOString().slice(0,16).replace('T',' ')}`;
      const createResp = await drive.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
      const docId = createResp.data.id!;
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text: minutesText, location: { index: 1 } } }] } });
      const file = await drive.files.get({ fileId: docId, fields: 'id,webViewLink' });

      let slidesLink: string | null = null;
      if (!output || (Array.isArray(output) && (output as any).includes('slides')) || output === 'slides' || output === 'both') {
        try {
          const slides = google.slides({ version: 'v1', auth: auth as any });
          const pres = await slides.presentations.create({ requestBody: { title: (title && String(title)) || `Meeting Slides ${new Date().toISOString().slice(0,10)}` } });
          const pid = pres.data.presentationId!;
          await slides.presentations.batchUpdate({ presentationId: pid, requestBody: { requests: [ { insertText: { objectId: pres.data.slides?.[0]?.objectId!, text: (title || 'Meeting Minutes') + '\n' + new Date().toLocaleString() } } ] } });
          slidesLink = `https://docs.google.com/presentation/d/${pid}/edit`;
        } catch {} 
      }

      let sheetLink: string | null = null;
      if (actionItems.length) {
        try {
          const sheets = google.sheets({ version: 'v4', auth: auth as any });
          const sh = await sheets.spreadsheets.create({ requestBody: { properties: { title: (title && String(title)) || `Action Items ${new Date().toISOString().slice(0,10)}` } } });
          const sid = sh.data.spreadsheetId!;
          await sheets.spreadsheets.values.update({ spreadsheetId: sid, range: 'A1', valueInputOption: 'RAW', requestBody: { values: [ ['item','ownerEmail','due','notes','createdAt'], ...actionItems.map(ai => [ai.title || '', ai.ownerEmail || '', ai.due || '', ai.notes || '', new Date().toISOString()]) ] } });
          sheetLink = `https://docs.google.com/spreadsheets/d/${sid}/edit`;
        } catch {} 
      }

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

      try { Metrics.minutesGenSuccess(true, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}
      res.json({ ok: true, docId, docLink: file.data.webViewLink, slidesLink, sheetLink });
    } catch (e) {
      try { Metrics.minutesGenSuccess(false, { tenant: process.env.DEFAULT_TENANT_ID || 'default' }); } catch {}
      res.status(500).json({ error: 'MINUTES_GEN_ERROR', details: (e as Error).message });
    }
  });

  // Generate mind map (visual data structure) for real-time display in the frontend
  // Input: { transcript: string, sessionId?: string }
  // Output: { success: boolean, mindmap: {...}, fallback?: boolean }
  router.post('/speech/generate-mindmap', async (req, res) => {
    try {
      const { transcript, sessionId } = req.body || {};
      if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 1) {
        return res.status(400).json({ success: false, error: 'INVALID_TRANSCRIPT' });
      }

      const buildFallback = (text: string) => {
        const sentences = text.split(/\\n+|[。．.!?！？…;；、,，]/).map(s => s.trim()).filter(Boolean).slice(0, 8);
        const children = sentences.map((s, i) => ({ id: `p_${i+1}`, label: s.slice(0, 32), type: 'point' as const }));
        return {
          title: 'Meeting Map',
          description: 'Key point extraction based on transcript (fallback)',
          rootNode: { id: 'root', label: 'Meeting', type: 'root' as const, children },
          metadata: {
            totalNodes: 1 + children.length,
            mainTopics: 0,
            actionItems: [],
            keyDecisions: [],
            participants: [],
            generatedAt: new Date().toISOString(),
            fallback: true
          }
        };
      };

      try {
        const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
        const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
        const modelName = process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro';
        const vx: any = await import('@google-cloud/vertexai').catch(() => null);
        if (!vx) return res.json({ success: true, mindmap: buildFallback(transcript), fallback: true });
        const { VertexAI } = vx;
        const client = new VertexAI({ project, location });
        const model = client.getGenerativeModel({ model: modelName });

        const prompt = `Please summarize the following meeting transcript into a JSON mindmap format:

{
  "title": string,
  "description": string,
  "rootNode": { "id": string, "label": string, "type": "root", "children": MindMapNode[] },
  "metadata": {
    "totalNodes": number,
    "mainTopics": number,
    "actionItems": string[],
    "keyDecisions": string[],
    "participants": string[],
    "generatedAt": string
  }
}

MindMapNode = { "id": string, "label": string, "type": "root"|"topic"|"point"|"action"|"decision", "color"?: string, "children"?: MindMapNode[] }

Requirements:
1) Identify main topics (topic), key points (point), action items (action), and decisions (decision) from the text.
2) Keep the total number of nodes under 30, and the labels concise.
3) Provide node statistics and generation time in the metadata.
4) Output only the JSON, with no extra explanation.

Transcript content:
${transcript}`;

        const resp = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
        const text = resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonStr = (text.match(/\{[\s\S]*\}/) || [text])[0];
        const mindmap = JSON.parse(jsonStr);
        // Lightweight validation
        if (!mindmap?.rootNode) throw new Error('Invalid mindmap');
        mindmap.metadata = mindmap.metadata || {};
        mindmap.metadata.generatedAt = new Date().toISOString();
        return res.json({ success: true, mindmap });
      } catch (e) {
        return res.json({ success: true, mindmap: buildFallback(transcript), fallback: true });
      }
    } catch (e) {
      return res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  return router;
}
