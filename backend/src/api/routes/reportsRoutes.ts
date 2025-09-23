import { Router } from 'express';
import { google } from 'googleapis';

export function reportsRoutes(): Router {
  const router = Router();

  // Preview weekly usage (no document creation); returns the same totals/rows logic used by the report
  router.get('/api/reports/weekly/preview', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(31, Number((req.query?.days as string) || 7)));
      const now = new Date();
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const dayStr = (d: Date) => d.toISOString().slice(0,10);
      const startDay = dayStr(start);
      const endDay = dayStr(now);

      let rows: Array<{ day: string; suggestions: number; auto_sent: number; confirmed: number; meetings: number; minutes: number }>= [];
      let source = 'bigquery';
      try {
        const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
        const project = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
        const bigquery = google.bigquery('v2');
        const query = `SELECT day, SUM(suggestions) AS suggestions, SUM(auto_sent) AS auto_sent, SUM(confirmed) AS confirmed, SUM(meetings) AS meetings, SUM(minutes) AS minutes\nFROM \`${project}.smartmeet_meetings.usage_daily\`\nWHERE day >= @start AND day <= @end\nGROUP BY day ORDER BY day`;
        const resp: any = await bigquery.jobs.query({ projectId: project, requestBody: { query, useLegacySql: false, parameterMode: 'NAMED', queryParameters: [ { name: 'start', parameterType: { type: 'STRING' }, parameterValue: { value: startDay } }, { name: 'end', parameterType: { type: 'STRING' }, parameterValue: { value: endDay } } ] }, auth });
        const schema = resp.data?.schema?.fields || [];
        const toObj = (r: any) => { const o: any = {}; r.f.forEach((c: any, i: number) => { o[schema[i].name] = isNaN(Number(c.v)) ? c.v : Number(c.v); }); return o; };
        rows = (resp.data?.rows || []).map(toObj);
      } catch {
        source = 'firestore';
        const db = new (await import('@google-cloud/firestore')).Firestore();
        const snap = await db.collection('usage_daily').get();
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

      return res.json({ ok: true, source, period: { start: startDay, end: endDay }, totals, rows, conversion });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Generate a weekly usage report Doc and return link
  router.post('/api/reports/weekly', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(31, Number(req.body?.days || 7)));
      const now = new Date();
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const dayStr = (d: Date) => d.toISOString().slice(0,10);
      const startDay = dayStr(start);
      const endDay = dayStr(now);

      // Load rollup from BigQuery, fallback to Firestore
      let rows: Array<{ day: string; suggestions: number; auto_sent: number; confirmed: number; meetings: number; minutes: number }>= [];
      let source = 'bigquery';
      try {
        const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
        const project = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
        const bigquery = google.bigquery('v2');
        const query = `SELECT day, SUM(suggestions) AS suggestions, SUM(auto_sent) AS auto_sent, SUM(confirmed) AS confirmed, SUM(meetings) AS meetings, SUM(minutes) AS minutes\nFROM \`${project}.smartmeet_meetings.usage_daily\`\nWHERE day >= @start AND day <= @end\nGROUP BY day ORDER BY day`;
        const resp: any = await bigquery.jobs.query({ projectId: project, requestBody: { query, useLegacySql: false, parameterMode: 'NAMED', queryParameters: [ { name: 'start', parameterType: { type: 'STRING' }, parameterValue: { value: startDay } }, { name: 'end', parameterType: { type: 'STRING' }, parameterValue: { value: endDay } } ] }, auth });
        const schema = resp.data?.schema?.fields || [];
        const toObj = (r: any) => { const o: any = {}; r.f.forEach((c: any, i: number) => { o[schema[i].name] = isNaN(Number(c.v)) ? c.v : Number(c.v); }); return o; };
        rows = (resp.data?.rows || []).map(toObj);
      } catch {
        source = 'firestore';
        const db = new (await import('@google-cloud/firestore')).Firestore();
        const snap = await db.collection('usage_daily').get();
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

      // Create Google Doc report
      const { google: g } = await import('googleapis');
      const auth2 = await g.auth.getClient({ scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'] });
      const drive = g.drive({ version: 'v3', auth: auth2 });
      const docs = g.docs({ version: 'v1', auth: auth2 as any });
      const title = `SmartMeet Weekly Report ${startDay} ~ ${endDay}`;
      const created = await drive.files.create({ requestBody: { name: title, mimeType: 'application/vnd.google-apps.document' }, fields: 'id,webViewLink' });
      const docId = created.data.id!;
      const lines: string[] = [];
      lines.push(`# ${title}`);
      lines.push('');
      lines.push(`Source: ${source}`);
      lines.push('');
      lines.push(`Totals: suggestions=${totals.suggestions}, auto_sent=${totals.auto_sent}, confirmed=${totals.confirmed}, meetings=${totals.meetings}, minutes=${totals.minutes}, conversion=${(conversion*100).toFixed(1)}%`);
      lines.push('');
      lines.push('Daily breakdown:');
      rows.forEach(r => { lines.push(`- ${r.day}: sug=${r.suggestions}, sent=${r.auto_sent}, conf=${r.confirmed}, mtg=${r.meetings}, min=${r.minutes}`); });
      const text = lines.join('\n');
      await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: [{ insertText: { text, location: { index: 1 } } }] } });
      const file = await drive.files.get({ fileId: docId, fields: 'id,webViewLink' });

      return res.json({ ok: true, link: file.data.webViewLink, totals, rows, source });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // Latest weekly report link (Drive search by title prefix)
  router.get('/api/reports/weekly/latest', async (_req, res) => {
    try {
      const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
      const drive = google.drive({ version: 'v3', auth });
      const prefix = 'SmartMeet Weekly Report ';
      const resp = await drive.files.list({
        q: `name contains '${prefix.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
        orderBy: 'modifiedTime desc',
        pageSize: 1,
        fields: 'files(id,name,webViewLink,modifiedTime)'
      });
      const file = (resp.data.files || [])[0] || null;
      if (!file) return res.json({ ok: true, found: false });
      return res.json({ ok: true, found: true, link: file.webViewLink, name: file.name, modifiedTime: file.modifiedTime });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
