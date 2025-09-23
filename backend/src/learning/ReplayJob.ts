import { Logger } from '../utils/Logger.js';
import { EpisodicMemory, Memory, MemoryType } from '../memory/MemorySystem.js';
import { RewardEngine, RewardMetrics } from './RewardEngine.js';
import { PolicyStore, PolicyVersion } from './PolicyStore.js';
import { ConfidenceThresholdManager } from '../security/ConfidenceThresholdManager.js';

export interface ReplayResult {
  metrics: RewardMetrics;
  policyBefore: PolicyVersion;
  policyAfter: PolicyVersion;
  changes: Partial<PolicyVersion['params']>;
  explorationResults?: ExplorationResult[];
  actionThresholdOptimizations?: ActionThresholdOptimization[];
}

export interface ActionThresholdOptimization {
  action: string;
  oldThreshold: number;
  newThreshold: number;
  expectedImprovement: number;
  actionSuccessRate: number;
  actionExecutionCount: number;
  reason: string;
}

export interface ExplorationResult {
  scenario: string;
  originalReward: number;
  exploredReward: number;
  improvement: number;
  recommendedChange: Partial<PolicyVersion['params']>;
}

export class ReplayJob {
  private logger: Logger;
  private reward: RewardEngine;
  private store: PolicyStore;
  private lr: number = 1.0;
  private explorationEnabled: boolean = true;
  private actionOptimizationEnabled: boolean = true;

  constructor(store: PolicyStore, options?: {
    learningRate?: number;
    enableExploration?: boolean;
    enableActionOptimization?: boolean;
  }) {
    this.logger = new Logger('ReplayJob');
    this.reward = new RewardEngine();
    this.store = store;
    if (options?.learningRate && options.learningRate > 0) this.lr = options.learningRate;
    if (options?.enableExploration !== undefined) this.explorationEnabled = options.enableExploration;
    if (options?.enableActionOptimization !== undefined) this.actionOptimizationEnabled = options.enableActionOptimization;
  }

  setLearningRate(lr: number) { if (lr > 0) this.lr = lr; }

  /**
   * 探索的戦略調整：失敗ケースに対する「仮定分析」
   * 「あの時閾値が異なっていたらどうなったか」を分析
   */
  private exploreCounterfactuals(memories: EpisodicMemory[], currentPolicy: PolicyVersion): ExplorationResult[] {
    const results: ExplorationResult[] = [];
    const failedMemories = memories.filter(m => !(m.content.result as any)?.success);

    if (failedMemories.length === 0) return results;

    // 为失败案例探索不同的阈值设置
    const explorationVariants = [
      { name: "lower_thresholds", proactiveThreshold: -0.1, autonomousThreshold: -0.1, escalationThreshold: 0.05 },
      { name: "higher_thresholds", proactiveThreshold: 0.1, autonomousThreshold: 0.1, escalationThreshold: -0.05 },
      { name: "more_proactive", proactiveThreshold: -0.15, autonomousThreshold: 0, escalationThreshold: 0 },
      { name: "more_conservative", proactiveThreshold: 0.15, autonomousThreshold: 0.15, escalationThreshold: 0.1 }
    ];

    for (const variant of explorationVariants) {
      // 模拟在新策略下的表现
      const simulatedPolicy = {
        ...currentPolicy,
        params: {
          proactiveThreshold: Math.max(0.1, Math.min(0.9, currentPolicy.params.proactiveThreshold + variant.proactiveThreshold)),
          autonomousThreshold: Math.max(0.1, Math.min(0.9, currentPolicy.params.autonomousThreshold + variant.autonomousThreshold)),
          escalationThreshold: Math.max(0.1, Math.min(0.9, currentPolicy.params.escalationThreshold + variant.escalationThreshold))
        }
      };

      // 计算在新策略下的奖励
      const simulatedReward = this.calculateSimulatedReward(failedMemories, simulatedPolicy);
      const originalReward = this.calculateSimulatedReward(failedMemories, currentPolicy);

      const improvement = simulatedReward - originalReward;

      if (improvement > 0.01) { // 只考虑有显著改进的变化
        results.push({
          scenario: variant.name,
          originalReward,
          exploredReward: simulatedReward,
          improvement,
          recommendedChange: {
            proactiveThreshold: simulatedPolicy.params.proactiveThreshold,
            autonomousThreshold: simulatedPolicy.params.autonomousThreshold,
            escalationThreshold: simulatedPolicy.params.escalationThreshold
          }
        });
      }
    }

    return results.sort((a, b) => b.improvement - a.improvement);
  }

  /**
   * 计算在给定策略下的模拟奖励
   */
  private calculateSimulatedReward(memories: EpisodicMemory[], policy: PolicyVersion): number {
    // 模拟策略对记忆的影响 - 使用真实的 ConfidenceThresholdManager 映射
    const simulatedMetrics = this.reward.analyzeWithPolicy(memories, (action: string) => {
      // 将策略参数映射到动作类型的基础阈值
      const baseThreshold = policy.params.proactiveThreshold; // 使用主动阈值作为基础

      // 根据动作类型调整阈值（与 ConfidenceThresholdManager 类似的逻辑）
      const actionMultiplierMap: Record<string, number> = {
        'get_events': 0.3,
        'analyze_conflicts': 0.4,
        'create_document': 0.6,
        'send_reminder': 0.7,
        'update_meeting': 0.8,
        'send_email': 0.75,
        'cancel_meeting': 0.9,
        'send_cancellation_notice': 0.88
      };

      const multiplier = actionMultiplierMap[action] || 0.8;
      return Math.min(0.95, Math.max(0.1, baseThreshold + multiplier * 0.5));
    });

    // 返回综合奖励分数（如果可用）或者成功率
    return (simulatedMetrics as any).totalRewardScore || simulatedMetrics.successRate;
  }

  /**
   * 基于探索结果进行策略优化
   */
  private optimizeBasedOnExploration(
    explorationResults: ExplorationResult[],
    baseChanges: Partial<PolicyVersion['params']>,
    currentPolicy: PolicyVersion
  ): Partial<PolicyVersion['params']> {
    if (explorationResults.length === 0) return baseChanges;

    const bestExploration = explorationResults[0];
    this.logger.info('Applying exploration-based optimization', {
      scenario: bestExploration.scenario,
      improvement: bestExploration.improvement,
      recommendedChange: bestExploration.recommendedChange
    });

    // 混合基础变化和探索结果，避免过大的跳跃
    const blendFactor = Math.min(this.lr * 0.5, 0.3); // 探索性变化的影响权重

    return {
      proactiveThreshold: baseChanges.proactiveThreshold! * (1 - blendFactor) +
                         (bestExploration.recommendedChange.proactiveThreshold! - currentPolicy.params.proactiveThreshold) * blendFactor,
      autonomousThreshold: baseChanges.autonomousThreshold! * (1 - blendFactor) +
                          (bestExploration.recommendedChange.autonomousThreshold! - currentPolicy.params.autonomousThreshold) * blendFactor,
      escalationThreshold: baseChanges.escalationThreshold! * (1 - blendFactor) +
                          (bestExploration.recommendedChange.escalationThreshold! - currentPolicy.params.escalationThreshold) * blendFactor
    };
  }

  /**
   * 分析每个动作的表现并优化其信心阈值
   */
  private optimizeActionThresholds(
    memories: EpisodicMemory[],
    thresholdManager: ConfidenceThresholdManager
  ): ActionThresholdOptimization[] {
    const optimizations: ActionThresholdOptimization[] = [];

    // 按动作分组分析记忆
    const actionGroups = new Map<string, EpisodicMemory[]>();

    for (const memory of memories) {
      const action = (memory as any)?.content?.action || {};
      const actionName = (action.type || action.action || action.action_type || action.name || '').toString();

      if (actionName && actionName !== 'unknown') {
        if (!actionGroups.has(actionName)) {
          actionGroups.set(actionName, []);
        }
        actionGroups.get(actionName)!.push(memory);
      }
    }

    // 为每个有足够数据的动作优化阈值
    for (const [actionName, actionMemories] of actionGroups) {
      if (actionMemories.length < 3) continue; // 需要足够的样本

      const currentThreshold = thresholdManager.getThreshold(actionName);
      const optimization = this.analyzeAndOptimizeActionThreshold(
        actionName,
        actionMemories,
        currentThreshold
      );

      if (optimization) {
        optimizations.push(optimization);
      }
    }

    return optimizations.sort((a, b) => b.expectedImprovement - a.expectedImprovement);
  }

  /**
   * 分析并优化单个动作的阈值
   */
  private analyzeAndOptimizeActionThreshold(
    actionName: string,
    memories: EpisodicMemory[],
    currentThreshold: number
  ): ActionThresholdOptimization | null {
    // 计算当前表现指标
    let successCount = 0;
    let totalCount = 0;
    let totalReward = 0;
    const confidenceValues: number[] = [];

    for (const memory of memories) {
      const result = (memory as any)?.content?.result;
      const reasoning = (memory as any)?.content?.reasoning;
      const confidence = reasoning?.confidence || 0;

      confidenceValues.push(confidence);
      totalCount++;

      if (result?.success) {
        successCount++;
      }

      // 计算该记忆的奖励分数
      const complexityReward = this.calculateComplexityReward(memory);
      const efficiencyReward = this.calculateEfficiencyReward(memory);
      const qualityReward = this.calculateQualityReward(memory);
      totalReward += (complexityReward * 0.3 + efficiencyReward * 0.3 + qualityReward * 0.4);
    }

    const currentSuccessRate = successCount / totalCount;
    const avgReward = totalReward / totalCount;

    // 分析不同阈值下的表现 - 根据学习率调整变化幅度
    const adjustmentRange = Math.max(0.05, this.learningRate * 0.2);
    const thresholdCandidates = [
      currentThreshold - adjustmentRange * 2,
      currentThreshold - adjustmentRange,
      currentThreshold + adjustmentRange,
      currentThreshold + adjustmentRange * 2
    ].filter(t => t >= 0.1 && t <= 0.95);

    let bestThreshold = currentThreshold;
    let bestScore = this.calculateThresholdScore(memories, currentThreshold);
    let bestImprovement = 0;

    for (const candidateThreshold of thresholdCandidates) {
      const candidateScore = this.calculateThresholdScore(memories, candidateThreshold);
      const improvement = candidateScore - bestScore;

      if (improvement > bestImprovement) {
        bestThreshold = candidateThreshold;
        bestScore = candidateScore;
        bestImprovement = improvement;
      }
    }

    // 只有当改进足够显著时才推荐调整 - 降低门槛以便更容易调整
    const improvementThreshold = Math.max(0.01, 0.05 / this.learningRate);
    if (bestImprovement > improvementThreshold) {
      let reason = 'performance_optimization';
      if (currentSuccessRate < 0.6) {
        reason = 'low_success_rate_improvement';
      } else if (avgReward < 0.4) {
        reason = 'reward_score_improvement';
      }

      return {
        action: actionName,
        oldThreshold: currentThreshold,
        newThreshold: bestThreshold,
        expectedImprovement: bestImprovement,
        actionSuccessRate: currentSuccessRate,
        actionExecutionCount: totalCount,
        reason
      };
    }

    return null;
  }

  /**
   * 计算在给定阈值下的综合分数
   */
  private calculateThresholdScore(memories: EpisodicMemory[], threshold: number): number {
    let totalScore = 0;
    let eligibleCount = 0;

    for (const memory of memories) {
      const reasoning = (memory as any)?.content?.reasoning;
      const confidence = reasoning?.confidence || 0;

      // 只考虑会被该阈值批准的动作
      if (confidence >= threshold) {
        eligibleCount++;

        const result = (memory as any)?.content?.result;
        const complexityReward = this.calculateComplexityReward(memory);
        const efficiencyReward = this.calculateEfficiencyReward(memory);
        const qualityReward = this.calculateQualityReward(memory);

        const rewardScore = (complexityReward * 0.3 + efficiencyReward * 0.3 + qualityReward * 0.4);
        const successBonus = result?.success ? 0.2 : 0;

        totalScore += rewardScore + successBonus;
      }
    }

    // 平衡执行率和质量：鼓励既有足够执行率又有高质量的阈值
    const executionRate = eligibleCount / memories.length;
    const avgQuality = eligibleCount > 0 ? totalScore / eligibleCount : 0;

    // 执行率过低或过高都不好，寻找最佳平衡点
    const executionRatePenalty = Math.abs(0.7 - executionRate) * 0.3;

    return avgQuality * executionRate - executionRatePenalty;
  }

  /**
   * 重复用于阈值分析的奖励计算方法（从RewardEngine复制过来避免依赖）
   */
  private calculateComplexityReward(memory: EpisodicMemory): number {
    const action = (memory as any)?.content?.action || {};
    const actionName = (action.type || action.action || action.action_type || action.name || '').toString();
    const tools = (memory as any)?.content?.tools_used || [];
    const dataSize = JSON.stringify(memory.content).length;

    let complexityScore = 0;
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
    complexityScore += Math.min(tools.length * 0.1, 0.3);
    complexityScore += Math.min(dataSize / 10000, 0.2);
    return Math.min(complexityScore, 1.0);
  }

  private calculateEfficiencyReward(memory: EpisodicMemory): number {
    const result = (memory as any)?.content?.result;
    const reasoning = (memory as any)?.content?.reasoning;
    let efficiencyScore = 0.5;
    const responseTime = result?.response_time || reasoning?.processing_time;
    if (typeof responseTime === 'number') {
      if (responseTime <= 2) efficiencyScore += 0.4;
      else if (responseTime <= 5) efficiencyScore += 0.3;
      else if (responseTime <= 10) efficiencyScore += 0.1;
      else efficiencyScore -= 0.1;
    }
    const retries = result?.retries || 0;
    efficiencyScore -= Math.min(retries * 0.1, 0.3);
    const confidence = reasoning?.confidence || 0;
    efficiencyScore += confidence * 0.2;
    return Math.max(0, Math.min(efficiencyScore, 1.0));
  }

  private calculateQualityReward(memory: EpisodicMemory): number {
    const result = (memory as any)?.content?.result;
    let qualityScore = 0;
    if (result?.success) {
      qualityScore += 0.6;
      if (result?.user_approved) qualityScore += 0.2;
      if (result?.no_human_intervention) qualityScore += 0.1;
      if (result?.exceeded_expectations) qualityScore += 0.1;
    } else {
      if (result?.partial_success) qualityScore += 0.2;
      if (result?.graceful_failure) qualityScore += 0.1;
    }
    return Math.max(0, Math.min(qualityScore, 1.0));
  }

  run(memories: Memory[], thresholdManager?: ConfidenceThresholdManager): ReplayResult {
    const episodic = memories.filter(m => m.metadata.type === MemoryType.EPISODIC) as EpisodicMemory[];
    const metrics = this.reward.analyze(episodic);

    const before = this.store.current();

    // 增强的策略调参逻辑 - 更积极的学习和更细致的调整
    let dProactive = 0, dAuto = 0, dEsc = 0;
    if (metrics.total >= 3) { // 降低最小样本要求，让小数据集也能学习
      // 使用增强的奖励指标进行决策
      const totalReward = (metrics as any).totalRewardScore || 0;
      const efficiency = (metrics as any).avgEfficiencyReward || 0;
      const quality = (metrics as any).avgQualityReward || 0;
      const policyAdjustedSuccessRate = (metrics as any).policyAdjustedSuccessRate || metrics.successRate;

      // 更积极的学习逻辑
      const learningFactor = this.lr * 0.1; // 基础调整幅度

      if (policyAdjustedSuccessRate >= 0.7 && totalReward >= 0.6) {
        // 高成功率且好奖励 → 更积极（放宽条件）
        dProactive += learningFactor * 1.5;
        dAuto += learningFactor * 1.5;
        dEsc -= learningFactor * 0.8;
      } else if (policyAdjustedSuccessRate >= 0.5 && totalReward >= 0.4) {
        // 中等表现 → 轻微优化
        dProactive += learningFactor * 0.8;
        dAuto += learningFactor * 0.8;
        dEsc -= learningFactor * 0.3;
      } else if (policyAdjustedSuccessRate < 0.4 || quality < 0.3) {
        // 低成功率或低质量 → 更保守
        dProactive -= learningFactor * 1.2;
        dAuto -= learningFactor * 1.2;
        dEsc += learningFactor * 1.0;
      }

      // 额外的效率和质量优化
      if (efficiency < 0.5) {
        // 效率低 → 降低阈值以提高响应速度
        dProactive -= learningFactor * 0.5;
        dAuto -= learningFactor * 0.5;
      }

      if (quality > 0.7) {
        // 质量高 → 可以更积极
        dProactive += learningFactor * 0.3;
        dAuto += learningFactor * 0.3;
      }

      this.logger.info('戦略調整計算', {
        successRate: metrics.successRate,
        policyAdjustedSuccessRate,
        totalReward,
        efficiency,
        quality,
        adjustments: { dProactive, dAuto, dEsc }
      });
    }

    let baseChanges = {
      proactiveThreshold: before.params.proactiveThreshold + dProactive,
      autonomousThreshold: before.params.autonomousThreshold + dAuto,
      escalationThreshold: before.params.escalationThreshold + dEsc,
    };

    // 探索机制：对失败案例进行反事实分析
    let explorationResults: ExplorationResult[] = [];
    if (this.explorationEnabled && episodic.length >= 3) {
      explorationResults = this.exploreCounterfactuals(episodic, before);

      if (explorationResults.length > 0) {
        this.logger.info('Exploration found improvements', {
          bestScenario: explorationResults[0].scenario,
          improvementFound: explorationResults[0].improvement,
          totalExplorations: explorationResults.length
        });

        // 基于探索结果优化基础变化
        baseChanges = this.optimizeBasedOnExploration(explorationResults, baseChanges, before);
      }
    }

    // 动作阈值优化：分析每个动作的表现并优化其信心阈值
    let actionThresholdOptimizations: ActionThresholdOptimization[] = [];
    if (this.actionOptimizationEnabled && thresholdManager && episodic.length >= 3) {
      actionThresholdOptimizations = this.optimizeActionThresholds(episodic, thresholdManager);

      if (actionThresholdOptimizations.length > 0) {
        this.logger.info('Action threshold optimizations found', {
          optimizationsCount: actionThresholdOptimizations.length,
          bestOptimization: actionThresholdOptimizations[0]
        });

        // 应用最有希望的阈值优化（最多3个，避免过度调整）
        const topOptimizations = actionThresholdOptimizations.slice(0, 3);
        for (const optimization of topOptimizations) {
          const success = thresholdManager.adjustThreshold(
            optimization.action,
            optimization.newThreshold,
            `Learning optimization: ${optimization.reason}`,
            'manual'
          );

          if (success) {
            this.logger.info(`Applied action threshold optimization for ${optimization.action}`, {
              oldThreshold: optimization.oldThreshold,
              newThreshold: optimization.newThreshold,
              expectedImprovement: optimization.expectedImprovement
            });
          }
        }
      }
    }

    // 应用边界检查
    const changes = {
      proactiveThreshold: Math.max(0.1, Math.min(0.9, baseChanges.proactiveThreshold)),
      autonomousThreshold: Math.max(0.1, Math.min(0.9, baseChanges.autonomousThreshold)),
      escalationThreshold: Math.max(0.1, Math.min(0.9, baseChanges.escalationThreshold)),
    };

    const after = this.store.update(changes, 'replay_adjustment', {
      metrics,
      explorationResults: explorationResults.length > 0 ? explorationResults[0] : undefined,
      actionOptimizations: actionThresholdOptimizations.length > 0 ? actionThresholdOptimizations[0] : undefined
    });

    this.logger.info('Enhanced replay job finished', {
      successRate: metrics.successRate,
      totalRewardScore: (metrics as any).totalRewardScore,
      explorationEnabled: this.explorationEnabled,
      explorationsFound: explorationResults.length,
      actionOptimizationEnabled: this.actionOptimizationEnabled,
      actionOptimizationsFound: actionThresholdOptimizations.length,
      changes,
      version: after.version,
    });

    return {
      metrics,
      policyBefore: before,
      policyAfter: after,
      changes,
      explorationResults,
      actionThresholdOptimizations
    };
  }
}
