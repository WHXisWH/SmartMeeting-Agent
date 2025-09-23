export type IntentOutput = {
  need_meeting: boolean;
  intent_score: number;
  participants: string[];
  time_hints?: any[];
  agenda_hints?: string[];
  doc_hints?: string[];
  rationale?: string;
};

export function sanitizeEmails(arr: any): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const m = String(s || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (m) out.push(m[0].toLowerCase());
  };
  if (Array.isArray(arr)) arr.forEach(v => push(String(v)));
  return Array.from(new Set(out));
}

export function ensureIntent(obj: any, fallbackParticipants: string[]): IntentOutput {
  const out: IntentOutput = {
    need_meeting: Boolean(obj?.need_meeting),
    intent_score: clamp01(toNumber(obj?.intent_score, 0)),
    participants: sanitizeEmails(obj?.participants)
  };
  if (out.participants.length === 0 && fallbackParticipants.length) out.participants = sanitizeEmails(fallbackParticipants);
  if (Array.isArray(obj?.time_hints)) out.time_hints = obj.time_hints;
  if (Array.isArray(obj?.agenda_hints)) out.agenda_hints = obj.agenda_hints.map((x: any)=>String(x));
  if (Array.isArray(obj?.doc_hints)) out.doc_hints = obj.doc_hints.map((x: any)=>String(x));
  if (typeof obj?.rationale === 'string') out.rationale = obj.rationale.slice(0, 1000);
  return out;
}

function toNumber(v: any, d = 0): number { const n = Number(v); return isFinite(n) ? n : d; }
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

