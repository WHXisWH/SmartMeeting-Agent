import { Router } from 'express';
import { google } from 'googleapis';
import { GoogleWorkspaceService } from '../../services/GoogleWorkspaceService.js';

// Lightweight utility to normalize due to ISO if possible
function toIsoOrUndefined(s?: string): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function actionItemsRoutes(): Router {
  const router = Router();
  const svc = new GoogleWorkspaceService();

  // Distribute action items: create Google Tasks entries, optional Sheet, and email owners
  // Body: { title?: string, items: [{ title:string, ownerEmail?:string, due?:string, notes?:string }], includeSheet?: boolean }
  router.post('/api/agent/action-items/distribute', async (req, res) => {
    try {
      const { title, items = [], includeSheet } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });

      const auth: any = (svc as any).auth;
      const tasks = google.tasks({ version: 'v1', auth });
      const gmail = google.gmail({ version: 'v1', auth });
      const drive = google.drive({ version: 'v3', auth });
      const sheets = google.sheets({ version: 'v4', auth: auth as any });

      let sheetLink: string | null = null;
      if (includeSheet) {
        try {
          const sh = await sheets.spreadsheets.create({ requestBody: { properties: { title: (title && String(title)) || `Action Items ${new Date().toISOString().slice(0,10)}` } } });
          const sid = sh.data.spreadsheetId!;
          await sheets.spreadsheets.values.update({ spreadsheetId: sid, range: 'A1', valueInputOption: 'RAW', requestBody: { values: [ ['item','ownerEmail','due','notes','createdAt'], ...items.map((ai: any) => [ai.title || '', ai.ownerEmail || '', ai.due || '', ai.notes || '', new Date().toISOString()]) ] } });
          sheetLink = `https://docs.google.com/spreadsheets/d/${sid}/edit`;
        } catch {}
      }

      // Ensure a dedicated task list exists
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
        for (const ai of items) {
          try {
            await tasks.tasks.insert({ tasklist: listId, requestBody: { title: ai.title || 'Action Item', notes: `${ai.notes || ''}${sheetLink ? `\nSheet: ${sheetLink}` : ''}${ai.ownerEmail ? `\nOwner: ${ai.ownerEmail}` : ''}`, due: toIsoOrUndefined(ai.due) } });
          } catch {}
        }
      }

      const grouped: Record<string, Array<{ title: string; due?: string; notes?: string }>> = {};
      for (const ai of items) {
        const owner = (ai.ownerEmail || '').trim();
        if (!owner) continue;
        if (!grouped[owner]) grouped[owner] = [];
        grouped[owner].push({ title: ai.title || 'Action Item', due: ai.due, notes: ai.notes });
      }
      for (const owner of Object.keys(grouped)) {
        try {
          const parts = grouped[owner].map(x => `<li>${x.title}${x.due ? ` (due: ${x.due})` : ''}${x.notes ? ` — ${x.notes}` : ''}</li>`).join('');
          const links = sheetLink ? `<p><a href=\"${sheetLink}\">Action Items Sheet</a></p>` : '';
          const html = `<p>You have new action items:</p><ul>${parts}</ul>${links}`;
          const rawLines = [ `To: ${owner}`, `Subject: New Action Items`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html ];
          const raw = Buffer.from(rawLines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        } catch {}
      }

      res.json({ ok: true, sheetLink, tasksListId: listId });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}

