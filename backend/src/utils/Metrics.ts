export class Metrics {
  private static counters = new Map<string, number>();
  private static separator = '||';

  static record(name: string, value: number, labels?: Record<string, string | number>): void {
    try {
      const entry = { name, value, labels: labels || {}, ts: Date.now() };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ severity: 'INFO', type: 'metric', entry }));
      const key = this.makeKey(name, labels);
      const prev = this.counters.get(key) || 0;
      this.counters.set(key, prev + value);
    } catch {}
  }

  static renderPrometheus(): string {
    const lines: string[] = [];
    for (const [key, val] of this.counters.entries()) {
      const { name, labels } = this.parseKey(key);
      const metric = sanitizeMetric(name) + '_total';
      const labelStr = labels && Object.keys(labels).length > 0 ? '{' + Object.entries(labels).map(([k,v])=>`${sanitizeLabel(k)}="${String(v).replace(/"/g,'\"')}"`).join(',') + '}' : '';
      lines.push(`${metric}${labelStr} ${val}`);
    }
    return lines.join('\n') + '\n';
  }

  private static makeKey(name: string, labels?: Record<string, string | number>): string {
    const base = String(name || 'metric');
    const lab = labels ? Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(',') : '';
    return base + this.separator + lab;
  }

  private static parseKey(key: string): { name: string; labels: Record<string,string> } {
    const [name, rest] = key.split(this.separator);
    const labels: Record<string,string> = {};
    if (rest) {
      for (const pair of rest.split(',')) {
        if (!pair) continue;
        const [k, v] = pair.split('=');
        if (k) labels[k] = String(v || '');
      }
    }
    return { name, labels };
  }

  static proposalLatencyMs(v: number, labels?: Record<string, string | number>) { this.record('proposal_latency_ms', v, labels); }
  static confirmSuccess(ok: boolean, labels?: Record<string, string | number>) { this.record('confirm_success', ok ? 1 : 0, labels); }
  static minutesGenSuccess(ok: boolean, labels?: Record<string, string | number>) { this.record('minutes_gen_success', ok ? 1 : 0, labels); }
  static endToEndFailure(ok: boolean, labels?: Record<string, string | number>) { this.record('end_to_end_failure', ok ? 0 : 1, labels); }
}

function sanitizeMetric(s: string): string { return String(s).replace(/[^a-zA-Z0-9_:]/g, '_'); }
function sanitizeLabel(s: string): string { return String(s).replace(/[^a-zA-Z0-9_]/g, '_'); }
