import { google } from 'googleapis';
import { Logger } from '../utils/Logger.js';

export type TimeSlot = { start: string; end: string; timezone: string };

export class SchedulingService {
  private logger = new Logger('SchedulingService');

  async generateCandidateSlots(auth: any, attendees: string[], opts?: { durationMin?: number; horizonHours?: number; timezone?: string }): Promise<TimeSlot[]> {
    const durationMin = Number(opts?.durationMin || process.env.MEETING_DEFAULT_DURATION_MIN || 30);
    const horizonHours = Number(opts?.horizonHours || process.env.MEETING_PROPOSAL_HORIZON_HOURS || 72);
    const tz = opts?.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.DEFAULT_TIMEZONE || 'UTC');

    const calendar = google.calendar({ version: 'v3', auth });
    const now = new Date();
    const endHorizon = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);
    const items = [{ id: 'primary' }, ...attendees.map(e => ({ id: e }))];
    let calendarsBusy: Record<string, Array<{ start: string; end: string }>> = {} as any;
    try {
      const fb = await calendar.freebusy.query({ requestBody: { timeMin: now.toISOString(), timeMax: endHorizon.toISOString(), items } });
      calendarsBusy = (fb.data.calendars || {}) as any;
    } catch (e) {
      this.logger.warn('FreeBusy query failed, continuing with self calendar only', { error: (e as any)?.message });
      calendarsBusy = {} as any;
    }

    const weights = await this.loadPolicyWeightsBQ().catch(() => null);
    const biz = Number((weights as any)?.weight_business_hours ?? 0.4);
    const pref = Number((weights as any)?.weight_preferred_hours ?? 0.1);

    const slots: TimeSlot[] = [];
    let cursor = new Date(now);
    const stepMin = durationMin;
    while (cursor < endHorizon && slots.length < 5) {
      const s = new Date(cursor);
      const e = new Date(s.getTime() + durationMin * 60 * 1000);
      const allFree = Object.keys(calendarsBusy).every(key => {
        const arr = (calendarsBusy as any)[key]?.busy || [];
        return !(arr as any[]).some((b: any) => Math.max(s.getTime(), new Date(b.start).getTime()) < Math.min(e.getTime(), new Date(b.end).getTime()));
      });
      if (allFree) {
        const h = new Date(s.toLocaleString('en-US', { timeZone: tz })).getHours();
        const score = (h >= 9 && h <= 18 ? biz : 0) + ([9,10,14].includes(h) ? pref : 0);
        if (score >= 0.1) slots.push({ start: toLocalIsoWithoutOffset(s), end: toLocalIsoWithoutOffset(e), timezone: tz });
        cursor = new Date(e);
      } else {
        cursor = new Date(cursor.getTime() + stepMin * 60 * 1000);
      }
    }
    return slots.slice(0, 3);
  }

  private async loadPolicyWeightsBQ(): Promise<any> {
    try {
      const { google } = await import('googleapis');
      const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
      const project = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
      const bigquery = google.bigquery('v2');
      const query = `SELECT * FROM \`${project}.smartmeet_meetings.policy_weights\` ORDER BY updated_at DESC LIMIT 1`;
      const resp: any = await bigquery.jobs.query({ projectId: project, requestBody: { query, useLegacySql: false }, auth });
      const rows = resp.data?.rows || [];
      if (!rows.length) return {};
      const schemaFields = resp.data?.schema?.fields || [];
      const toObj = (row: any) => {
        const obj: any = {};
        row.f.forEach((cell: any, idx: number) => { obj[schemaFields[idx].name] = cell.v; });
        return obj;
      };
      return toObj(rows[0]);
    } catch {
      return {};
    }
  }
}

function toLocalIsoWithoutOffset(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
