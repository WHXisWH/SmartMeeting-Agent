import { Logger } from '../utils/Logger.js';
import { PolicyParams } from './PolicyStore.js';
import { ConfidenceThresholdManager } from '../security/ConfidenceThresholdManager.js';

export class RuntimePolicyApplier {
  private logger = new Logger('RuntimePolicyApplier');

  applyToThresholds(policy: PolicyParams, manager: ConfidenceThresholdManager): { updated: Array<{action: string, threshold: number}> } {
    // 将全局阈值映射到典型动作上（示例映射，可按需扩展）
    const updates: Array<{ action: string; value: number }> = [
      // 低风险（使用 proactiveThreshold ）
      { action: 'get_events', value: policy.proactiveThreshold },
      { action: 'analyze_conflicts', value: Math.max(0.2, policy.proactiveThreshold) },
      // 中风险（靠近 autonomousThreshold）
      { action: 'create_document', value: Math.max(0.4, policy.autonomousThreshold) },
      { action: 'send_reminder', value: Math.max(0.5, policy.autonomousThreshold) },
      // 高风险（不低于 autonomousThreshold，略提高）
      { action: 'update_meeting', value: Math.min(0.95, Math.max(0.7, policy.autonomousThreshold + 0.05)) },
      { action: 'send_email', value: Math.min(0.9, Math.max(0.7, policy.autonomousThreshold)) },
      // 极高风险（保持较高上限）
      { action: 'cancel_meeting', value: Math.max(0.85, policy.autonomousThreshold + 0.1) },
      { action: 'send_cancellation_notice', value: Math.max(0.85, policy.autonomousThreshold + 0.08) },
    ];

    const applied: Array<{ action: string; threshold: number }> = [];
    for (const u of updates) {
      const ok = manager.setThreshold(u.action, u.value, 'policy_apply');
      if (ok) applied.push({ action: u.action, threshold: u.value });
    }

    this.logger.info('Applied policy to thresholds', { appliedCount: applied.length });
    return { updated: applied };
  }
}

