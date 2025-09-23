import { Logger } from '../utils/Logger.js';
import { EpisodicMemory } from '../memory/MemorySystem.js';

export interface RewardMetrics {
  total: number;
  successCount: number;
  failureCount: number;
  avgSatisfaction: number; // 0..1
  avgTimeSaved: number; // minutes
  conflictsResolved: number;
  rollbacks: number;
  successRate: number; // 0..1
  // 新增细化奖励指标
  avgComplexityReward: number; // 基于任务复杂度的奖励
  avgEfficiencyReward: number; // 基于响应效率的奖励
  avgQualityReward: number; // 基于执行质量的奖励
  totalRewardScore: number; // 综合奖励分数
  // 额外：与当前策略（阈值）相关的指标
  policyApprovalRate?: number; // 按当前阈值，会被"允许执行"的样本占比
  policyAdjustedSuccessRate?: number; // 在被允许执行的样本上成功的比例（或对全体的加权）
}

export class RewardEngine {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('RewardEngine');
  }

  /**
   * 计算任务复杂度奖励
   * 基于动作类型、涉及的工具数量、处理的数据量等
   */
  private calculateComplexityReward(memory: EpisodicMemory): number {
    const action = (memory as any)?.content?.action || {};
    const actionName = (action.action || action.action_type || action.type || action.name || '').toString();
    const tools = (memory as any)?.content?.tools_used || [];
    const dataSize = JSON.stringify(memory.content).length;

    let complexityScore = 0;

    // 基于动作类型的复杂度
    const complexityMap: Record<string, number> = {
      'create_document': 0.8,
      'schedule_meeting': 0.9,
      'send_notification': 0.3,
      'analyze_data': 0.95,
      'resolve_conflict': 1.0,
      'escalate_issue': 0.6,
      'search_information': 0.4,
      'generate_report': 0.85
    };

    complexityScore += complexityMap[actionName] || 0.5;

    // 基于工具使用数量
    complexityScore += Math.min(tools.length * 0.1, 0.3);

    // 基于数据量（归一化）
    complexityScore += Math.min(dataSize / 10000, 0.2);

    return Math.min(complexityScore, 1.0);
  }

  /**
   * 计算效率奖励
   * 基于响应时间、重试次数等
   */
  private calculateEfficiencyReward(memory: EpisodicMemory): number {
    const timestamp = memory.metadata?.timestamp;
    const result = (memory as any)?.content?.result;
    const reasoning = (memory as any)?.content?.reasoning;

    let efficiencyScore = 0.5; // 基础分数

    // 基于响应时间（如果有的话）
    const responseTime = result?.response_time || reasoning?.processing_time;
    if (typeof responseTime === 'number') {
      // 响应时间越短，效率奖励越高（假设理想响应时间为1-5秒）
      if (responseTime <= 2) efficiencyScore += 0.4;
      else if (responseTime <= 5) efficiencyScore += 0.3;
      else if (responseTime <= 10) efficiencyScore += 0.1;
      else efficiencyScore -= 0.1;
    }

    // 基于重试次数
    const retries = result?.retries || 0;
    efficiencyScore -= Math.min(retries * 0.1, 0.3);

    // 基于信心度（高信心度通常意味着更高效的决策）
    const confidence = reasoning?.confidence || 0;
    efficiencyScore += confidence * 0.2;

    return Math.max(0, Math.min(efficiencyScore, 1.0));
  }

  /**
   * 计算质量奖励
   * 基于成功程度、用户满意度、是否需要人工干预等
   */
  private calculateQualityReward(memory: EpisodicMemory): number {
    const result = (memory as any)?.content?.result;
    const reward = (memory as any)?.content?.reward || {};

    let qualityScore = 0;

    // 基础成功奖励
    if (result?.success) {
      qualityScore += 0.6;

      // 额外质量因素
      if (result?.user_approved) qualityScore += 0.2;
      if (result?.no_human_intervention) qualityScore += 0.1;
      if (result?.exceeded_expectations) qualityScore += 0.1;
    } else {
      // 即使失败，如果有部分成功也给予一定奖励
      if (result?.partial_success) qualityScore += 0.2;
      if (result?.graceful_failure) qualityScore += 0.1;
    }

    // 用户满意度（如果有的话）
    if (typeof reward.satisfaction === 'number') {
      qualityScore = Math.max(qualityScore, reward.satisfaction);
    }

    return Math.max(0, Math.min(qualityScore, 1.0));
  }

  analyze(memories: EpisodicMemory[]): RewardMetrics {
    const total = memories.length;
    let successCount = 0;
    let failureCount = 0;
    let satSum = 0;
    let timeSavedSum = 0;
    let conflictsResolved = 0;
    let rollbacks = 0;

    // 新增奖励指标累计器
    let complexitySum = 0;
    let efficiencySum = 0;
    let qualitySum = 0;
    let totalRewardSum = 0;

    for (const m of memories) {
      const r = m.content.result;
      const rew = m.content.reward || {} as any;

      // 原有逻辑
      if (r?.success) successCount++; else failureCount++;

      // 增强的满意度计算：如果原始数据为空，使用智能计算
      let satisfaction = 0;
      if (typeof rew.satisfaction === 'number') {
        satisfaction = Math.max(0, Math.min(1, rew.satisfaction));
      } else {
        // 智能计算满意度：基于成功率和质量
        satisfaction = this.calculateQualityReward(m);
      }
      satSum += satisfaction;

      // 增强的时间节省计算
      let timeSaved = 0;
      if (typeof rew.time_saved === 'number') {
        timeSaved = Math.max(0, rew.time_saved);
      } else {
        // 智能计算时间节省：基于效率和成功率
        const efficiency = this.calculateEfficiencyReward(m);
        const complexity = this.calculateComplexityReward(m);
        timeSaved = r?.success ? (efficiency * complexity * 10) : 0; // 最大節約時間を10分と仮定
      }
      timeSavedSum += timeSaved;

      if (typeof rew.conflicts_resolved === 'number') conflictsResolved += Math.max(0, rew.conflicts_resolved);
      if (typeof rew.rollbacks === 'number') rollbacks += Math.max(0, rew.rollbacks);

      // 计算新的奖励指标
      const complexityReward = this.calculateComplexityReward(m);
      const efficiencyReward = this.calculateEfficiencyReward(m);
      const qualityReward = this.calculateQualityReward(m);

      complexitySum += complexityReward;
      efficiencySum += efficiencyReward;
      qualitySum += qualityReward;

      // 综合奖励分数：加权平均
      const totalReward = (complexityReward * 0.3 + efficiencyReward * 0.3 + qualityReward * 0.4);
      totalRewardSum += totalReward;
    }

    const successRate = total > 0 ? successCount / total : 0;
    const avgSatisfaction = total > 0 ? satSum / total : 0;
    const avgTimeSaved = total > 0 ? timeSavedSum / total : 0;
    const avgComplexityReward = total > 0 ? complexitySum / total : 0;
    const avgEfficiencyReward = total > 0 ? efficiencySum / total : 0;
    const avgQualityReward = total > 0 ? qualitySum / total : 0;
    const totalRewardScore = total > 0 ? totalRewardSum / total : 0;

    this.logger.info('Enhanced reward analysis completed', {
      total,
      successRate,
      avgSatisfaction,
      avgTimeSaved,
      avgComplexityReward,
      avgEfficiencyReward,
      avgQualityReward,
      totalRewardScore
    });

    return {
      total,
      successCount,
      failureCount,
      avgSatisfaction,
      avgTimeSaved,
      conflictsResolved,
      rollbacks,
      successRate,
      avgComplexityReward,
      avgEfficiencyReward,
      avgQualityReward,
      totalRewardScore
    };
  }

  // 基于策略阈值的评估：估计"当前策略会放行的样本"以及这些样本的成功率
  analyzeWithPolicy(memories: EpisodicMemory[], getThreshold: (action: string) => number): RewardMetrics {
    const base = this.analyze(memories);

    let considered = 0;
    let approved = 0;
    let approvedSuccess = 0;
    let approvedRewardSum = 0;

    for (const m of memories) {
      const action = (m as any)?.content?.action || {};
      // 兼容多个字段名以提取动作名称（type 是標準字段）
      const actionName: string = (action.type || action.action || action.action_type || action.name || '').toString();
      const conf: number = Number((m as any)?.content?.reasoning?.confidence ?? (m as any)?.metadata?.confidence ?? 0);

      // 調試：输出動作名稱提取情況和原始數據結構
      console.log('DEBUG: Processing memory:', {
        memoryId: (m as any)?.metadata?.id,
        actionObject: action,
        fullContent: (m as any)?.content,
        extractedActionName: actionName,
        confidence: conf
      });

      if (!actionName) {
        console.log('Empty action name detected:', {action, fullContent: (m as any)?.content});
        continue;
      } else {
        console.log('Action extracted:', actionName, 'confidence:', conf, 'action.action:', action.action, 'action.action_type:', action.action_type);
      }
      considered++;
      const threshold = getThreshold(actionName);
      const isApproved = conf >= threshold;

      if (isApproved) {
        approved++;
        if ((m as any)?.content?.result?.success) approvedSuccess++;

        // 计算被批准样本的综合奖励
        const complexityReward = this.calculateComplexityReward(m);
        const efficiencyReward = this.calculateEfficiencyReward(m);
        const qualityReward = this.calculateQualityReward(m);
        const totalReward = (complexityReward * 0.3 + efficiencyReward * 0.3 + qualityReward * 0.4);
        approvedRewardSum += totalReward;
      }
    }

    const approvalRate = considered > 0 ? approved / considered : 0;
    // policy 调整后的"成功率"：在放行样本上的成功率
    const adjustedSuccess = approved > 0 ? approvedSuccess / approved : base.successRate;

    // 为策略评估提供更丰富的奖励信息
    const policyAdjustedRewardScore = approved > 0 ? approvedRewardSum / approved : base.totalRewardScore;


    return {
      ...base,
      policyApprovalRate: approvalRate,
      policyAdjustedSuccessRate: adjustedSuccess,
      // 添加策略调整后的奖励分数，供学习算法使用
      policyAdjustedRewardScore
    } as RewardMetrics & { policyAdjustedRewardScore?: number };
  }
}
