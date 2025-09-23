import { Logger } from '../utils/Logger.js';

export interface PolicyParams {
  proactiveThreshold: number;   // 建议主动触发阈值 0..1
  autonomousThreshold: number;  // 自动执行阈值 0..1
  escalationThreshold: number;  // 升级审批阈值 0..1（越低越易升级）
}

export interface PolicyVersion {
  version: number;
  timestamp: string;
  notes?: string;
  params: PolicyParams;
  metricsSnapshot?: any;
}

export class PolicyStore {
  private logger: Logger;
  private history: PolicyVersion[] = [];

  constructor(initial?: PolicyParams) {
    this.logger = new Logger('PolicyStore');
    const base: PolicyParams = initial ?? {
      proactiveThreshold: 0.7,
      autonomousThreshold: 0.8,
      escalationThreshold: 0.3,
    };
    this.history.push({ version: 1, timestamp: new Date().toISOString(), params: base, notes: 'initial' });
  }

  current(): PolicyVersion { return this.history[this.history.length - 1]; }
  all(): PolicyVersion[] { return [...this.history]; }

  update(params: Partial<PolicyParams>, notes?: string, metricsSnapshot?: any): PolicyVersion {
    const cur = this.current();
    const merged: PolicyParams = {
      proactiveThreshold: clamp(params.proactiveThreshold ?? cur.params.proactiveThreshold),
      autonomousThreshold: clamp(params.autonomousThreshold ?? cur.params.autonomousThreshold),
      escalationThreshold: clamp(params.escalationThreshold ?? cur.params.escalationThreshold),
    };
    const v: PolicyVersion = {
      version: cur.version + 1,
      timestamp: new Date().toISOString(),
      params: merged,
      notes,
      metricsSnapshot,
    };
    this.history.push(v);
    this.logger.info('Policy updated', { version: v.version, params: v.params, notes });
    return v;
  }

  rollback(notes: string = 'rollback_to_previous'): PolicyVersion {
    if (this.history.length < 2) {
      // 没有可回滚的版本，复制当前作为新版本
      const cur = this.current();
      const dup: PolicyVersion = {
        version: cur.version + 1,
        timestamp: new Date().toISOString(),
        params: { ...cur.params },
        notes,
      };
      this.history.push(dup);
      return dup;
    }
    const prev = this.history[this.history.length - 2];
    const cur = this.current();
    const rolled: PolicyVersion = {
      version: cur.version + 1,
      timestamp: new Date().toISOString(),
      params: { ...prev.params },
      notes,
    };
    this.history.push(rolled);
    return rolled;
  }
}

function clamp(n: number): number { return Math.max(0, Math.min(1, n)); }
