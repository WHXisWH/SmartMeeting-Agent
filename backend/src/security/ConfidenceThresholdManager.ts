/**
 * Confidence Threshold Manager - Stage 6 Dynamic Safety Threshold System
 * 
 * Manages and dynamically adjusts confidence thresholds for various actions, learning from historical execution results and user feedback.
 */

import { Logger } from '../utils/Logger.js';
import { ActionRiskLevel } from './ActionSafetyClassifier.js';

export interface ThresholdAdjustmentHistory {
  timestamp: Date;
  action: string;
  oldThreshold: number;
  newThreshold: number;
  reason: string;
  triggeredBy: 'success_rate' | 'user_feedback' | 'error_rate' | 'manual' | 'emergency';
}

export interface ActionPerformanceMetrics {
  action: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  userRejectionsCount: number;
  averageUserSatisfaction: number; // 0-5
  lastSuccessRate: number; // 0-1
  trendingSuccessRate: number; // Success rate of the last 10 executions
  recommendedThreshold: number;
}

export interface ThresholdConfiguration {
  action: string;
  baseThreshold: number; // Initial baseline threshold
  currentThreshold: number; // Current dynamic threshold
  minThreshold: number; // Minimum allowed threshold
  maxThreshold: number; // Maximum allowed threshold
  adjustmentSensitivity: number; // Adjustment sensitivity (0-1)
  lastAdjustment: Date;
  adjustmentCount: number;
  riskLevel: ActionRiskLevel;
}

export class ConfidenceThresholdManager {
  private logger: Logger;
  private thresholds: Map<string, ThresholdConfiguration>;
  private performanceMetrics: Map<string, ActionPerformanceMetrics>;
  private adjustmentHistory: ThresholdAdjustmentHistory[];
  private maxHistorySize: number = 1000;

  // System parameters
  private readonly LEARNING_RATE = 0.1; // Learning rate
  private readonly MIN_EXECUTIONS_FOR_ADJUSTMENT = 10; // Minimum number of executions to adjust
  private readonly SUCCESS_RATE_THRESHOLD = 0.8; // Success rate threshold
  private readonly MAX_ADJUSTMENTS_PER_DAY = 3; // Maximum number of adjustments per day

  constructor() {
    this.logger = new Logger('ConfidenceThresholdManager');
    this.thresholds = new Map();
    this.performanceMetrics = new Map();
    this.adjustmentHistory = [];
    this.initializeDefaultThresholds();
  }

  /**
   * Initialize default threshold configurations
   */
  private initializeDefaultThresholds(): void {
    const defaultConfigs: ThresholdConfiguration[] = [
      // Low-risk actions
      {
        action: 'get_events',
        baseThreshold: 0.3,
        currentThreshold: 0.3,
        minThreshold: 0.1,
        maxThreshold: 0.6,
        adjustmentSensitivity: 0.3,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.LOW
      },
      {
        action: 'analyze_conflicts',
        baseThreshold: 0.4,
        currentThreshold: 0.4,
        minThreshold: 0.2,
        maxThreshold: 0.7,
        adjustmentSensitivity: 0.3,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.LOW
      },

      // Medium-risk actions
      {
        action: 'create_document',
        baseThreshold: 0.6,
        currentThreshold: 0.6,
        minThreshold: 0.4,
        maxThreshold: 0.8,
        adjustmentSensitivity: 0.2,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.MEDIUM
      },
      {
        action: 'send_reminder',
        baseThreshold: 0.7,
        currentThreshold: 0.7,
        minThreshold: 0.5,
        maxThreshold: 0.85,
        adjustmentSensitivity: 0.2,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.MEDIUM
      },

      // High-risk actions
      {
        action: 'update_meeting',
        baseThreshold: 0.8,
        currentThreshold: 0.8,
        minThreshold: 0.65,
        maxThreshold: 0.95,
        adjustmentSensitivity: 0.1,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.HIGH
      },
      {
        action: 'send_email',
        baseThreshold: 0.75,
        currentThreshold: 0.75,
        minThreshold: 0.6,
        maxThreshold: 0.9,
        adjustmentSensitivity: 0.15,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.HIGH
      },

      // Critical-risk actions
      {
        action: 'cancel_meeting',
        baseThreshold: 0.9,
        currentThreshold: 0.9,
        minThreshold: 0.8,
        maxThreshold: 0.98,
        adjustmentSensitivity: 0.05,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.CRITICAL
      },
      {
        action: 'send_cancellation_notice',
        baseThreshold: 0.88,
        currentThreshold: 0.88,
        minThreshold: 0.78,
        maxThreshold: 0.97,
        adjustmentSensitivity: 0.05,
        lastAdjustment: new Date(),
        adjustmentCount: 0,
        riskLevel: ActionRiskLevel.CRITICAL
      }
    ];

    // Register all threshold configurations
    defaultConfigs.forEach(config => {
      this.thresholds.set(config.action, config);
      
      // Initialize performance metrics
      this.performanceMetrics.set(config.action, {
        action: config.action,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        userRejectionsCount: 0,
        averageUserSatisfaction: 3.0,
        lastSuccessRate: 1.0,
        trendingSuccessRate: 1.0,
        recommendedThreshold: config.baseThreshold
      });
    });

    this.logger.info(`Initialized ${defaultConfigs.length} confidence threshold configurations`);
  }

  /**
   * Get the current confidence threshold for an action
   */
  public getThreshold(action: string): number {
    const config = this.thresholds.get(action);
    if (!config) {
      this.logger.warn(`No threshold configuration found for action: ${action}, using default 0.8`);
      return 0.8; // Default to a high threshold for safety
    }
    return config.currentThreshold;
  }

  /**
   * Record the result of an action execution to learn and adjust thresholds
   */
  public recordExecutionResult(
    action: string,
    confidence: number,
    success: boolean,
    userSatisfaction?: number,
    userFeedback?: string
  ): void {
    const metrics = this.performanceMetrics.get(action);
    if (!metrics) {
      this.logger.warn(`No metrics found for action: ${action}`);
      return;
    }

    // Update basic metrics
    metrics.totalExecutions++;
    if (success) {
      metrics.successfulExecutions++;
    } else {
      metrics.failedExecutions++;
    }

    // Update user satisfaction
    if (userSatisfaction !== undefined) {
      const totalSatisfactionScore = metrics.averageUserSatisfaction * (metrics.totalExecutions - 1) + userSatisfaction;
      metrics.averageUserSatisfaction = totalSatisfactionScore / metrics.totalExecutions;
    }

    // Calculate success rate
    metrics.lastSuccessRate = metrics.successfulExecutions / metrics.totalExecutions;

    // Calculate trending success rate (last 10 executions)
    // This is a simplified approach; a real implementation should maintain a history queue
    metrics.trendingSuccessRate = metrics.lastSuccessRate;

    // Update recommended threshold
    metrics.recommendedThreshold = this.calculateRecommendedThreshold(metrics);

    this.logger.info(`Recorded execution result for ${action}`, {
      confidence,
      success,
      successRate: metrics.lastSuccessRate,
      userSatisfaction,
      totalExecutions: metrics.totalExecutions
    });

    // Check if threshold adjustment is needed
    this.evaluateThresholdAdjustment(action, metrics);
  }

  /**
   * Record user rejection of an action
   */
  public recordUserRejection(action: string, confidence: number, reason?: string): void {
    const metrics = this.performanceMetrics.get(action);
    if (!metrics) {
      this.logger.warn(`No metrics found for action: ${action}`);
      return;
    }

    metrics.userRejectionsCount++;
    
    this.logger.info(`User rejected action ${action}`, {
      confidence,
      reason,
      totalRejections: metrics.userRejectionsCount
    });

    // User rejection may indicate that the threshold is too low, so evaluate for adjustment
    this.evaluateThresholdAdjustment(action, metrics);
  }

  /**
   * Calculate the recommended confidence threshold
   */
  private calculateRecommendedThreshold(metrics: ActionPerformanceMetrics): number {
    let recommendedThreshold = 0.5; // Baseline value

    // Adjust based on success rate
    if (metrics.lastSuccessRate >= 0.9) {
      recommendedThreshold = 0.6; // High success rate, can lower the threshold
    } else if (metrics.lastSuccessRate >= 0.8) {
      recommendedThreshold = 0.7; // Good success rate
    } else if (metrics.lastSuccessRate >= 0.6) {
      recommendedThreshold = 0.8; // Medium success rate, increase the threshold
    } else {
      recommendedThreshold = 0.9; // Low success rate, requires a high threshold
    }

    // Adjust based on user satisfaction
    if (metrics.averageUserSatisfaction >= 4.0) {
      recommendedThreshold -= 0.05; // High satisfaction, can slightly lower the threshold
    } else if (metrics.averageUserSatisfaction <= 2.5) {
      recommendedThreshold += 0.1; // Low satisfaction, increase the threshold
    }

    // Adjust based on user rejection rate
    const rejectionRate = metrics.userRejectionsCount / Math.max(metrics.totalExecutions, 1);
    if (rejectionRate > 0.2) {
      recommendedThreshold += 0.1; // High rejection rate, increase the threshold
    }

    return Math.max(0.1, Math.min(0.98, recommendedThreshold));
  }

  /**
   * Evaluate if a threshold adjustment is needed
   */
  private evaluateThresholdAdjustment(action: string, metrics: ActionPerformanceMetrics): void {
    const config = this.thresholds.get(action);
    if (!config) return;

    // Check if adjustment conditions are met
    if (metrics.totalExecutions < this.MIN_EXECUTIONS_FOR_ADJUSTMENT) {
      return; // Insufficient number of executions
    }

    // Check daily adjustment limit
    const today = new Date();
    const adjustmentsToday = this.adjustmentHistory.filter(h => 
      h.action === action && 
      h.timestamp.toDateString() === today.toDateString()
    ).length;

    if (adjustmentsToday >= this.MAX_ADJUSTMENTS_PER_DAY) {
      return; // Daily adjustment limit reached
    }

    // Calculate recommended new threshold
    const recommendedThreshold = metrics.recommendedThreshold;
    const currentThreshold = config.currentThreshold;
    const thresholdDifference = Math.abs(recommendedThreshold - currentThreshold);

    // Only adjust if the difference exceeds the sensitivity threshold
    if (thresholdDifference < config.adjustmentSensitivity) {
      return;
    }

    // Determine the reason for adjustment
    let reason = 'performance_optimization';
    let triggeredBy: ThresholdAdjustmentHistory['triggeredBy'] = 'success_rate';

    if (metrics.lastSuccessRate < this.SUCCESS_RATE_THRESHOLD) {
      reason = 'low_success_rate_detected';
      triggeredBy = 'error_rate';
    } else if (metrics.userRejectionsCount / metrics.totalExecutions > 0.2) {
      reason = 'high_user_rejection_rate';
      triggeredBy = 'user_feedback';
    } else if (metrics.averageUserSatisfaction < 2.5) {
      reason = 'low_user_satisfaction';
      triggeredBy = 'user_feedback';
    }

    // Perform threshold adjustment
    this.adjustThreshold(action, recommendedThreshold, reason, triggeredBy);
  }

  /**
   * Adjust the confidence threshold
   */
  public adjustThreshold(
    action: string,
    newThreshold: number,
    reason: string,
    triggeredBy: ThresholdAdjustmentHistory['triggeredBy']
  ): boolean {
    const config = this.thresholds.get(action);
    if (!config) {
      this.logger.error(`Cannot adjust threshold for unknown action: ${action}`);
      return false;
    }

    // Ensure the new threshold is within the allowed range
    const clampedThreshold = Math.max(config.minThreshold, Math.min(config.maxThreshold, newThreshold));

    if (clampedThreshold === config.currentThreshold) {
      return false; // No adjustment needed
    }

    const oldThreshold = config.currentThreshold;

    // Update threshold configuration
    config.currentThreshold = clampedThreshold;
    config.lastAdjustment = new Date();
    config.adjustmentCount++;

    // Record adjustment history
    const adjustmentRecord: ThresholdAdjustmentHistory = {
      timestamp: new Date(),
      action,
      oldThreshold,
      newThreshold: clampedThreshold,
      reason,
      triggeredBy
    };

    this.adjustmentHistory.push(adjustmentRecord);

    // Maintain history size limit
    if (this.adjustmentHistory.length > this.maxHistorySize) {
      this.adjustmentHistory = this.adjustmentHistory.slice(-this.maxHistorySize);
    }

    this.logger.info(`Adjusted confidence threshold for ${action}`, {
      oldThreshold,
      newThreshold: clampedThreshold,
      reason,
      triggeredBy
    });

    return true;
  }

  /**
   * Manually set a threshold (administrator function)
   */
  public setThreshold(action: string, threshold: number, reason: string = 'manual_override'): boolean {
    const config = this.thresholds.get(action);
    if (!config) {
      this.logger.error(`Cannot set threshold for unknown action: ${action}`);
      return false;
    }

    const clampedThreshold = Math.max(config.minThreshold, Math.min(config.maxThreshold, threshold));
    return this.adjustThreshold(action, clampedThreshold, reason, 'manual');
  }

  /**
   * Urgently raise all thresholds (safe mode)
   */
  public enableEmergencyMode(reason: string = 'security_incident'): void {
    this.logger.warn('Enabling emergency mode - raising all confidence thresholds');

    this.thresholds.forEach((config, action) => {
      const emergencyThreshold = Math.min(config.maxThreshold, config.currentThreshold + 0.2);
      this.adjustThreshold(action, emergencyThreshold, `Emergency mode: ${reason}`, 'emergency');
    });
  }

  /**
   * Reset thresholds to baseline values
   */
  public resetThresholdsToBaseline(action?: string): void {
    if (action) {
      const config = this.thresholds.get(action);
      if (config) {
        this.adjustThreshold(action, config.baseThreshold, 'reset_to_baseline', 'manual');
      }
    } else {
      this.thresholds.forEach((config, actionName) => {
        this.adjustThreshold(actionName, config.baseThreshold, 'reset_to_baseline', 'manual');
      });
    }
  }

  /**
   * Get all threshold configurations
   */
  public getAllThresholds(): ThresholdConfiguration[] {
    return Array.from(this.thresholds.values());
  }

  /**
   * Get performance metrics
   */
  public getPerformanceMetrics(action?: string): ActionPerformanceMetrics[] {
    if (action) {
      const metrics = this.performanceMetrics.get(action);
      return metrics ? [metrics] : [];
    }
    return Array.from(this.performanceMetrics.values());
  }

  /**
   * Get adjustment history
   */
  public getAdjustmentHistory(action?: string, limit: number = 50): ThresholdAdjustmentHistory[] {
    let history = this.adjustmentHistory;
    
    if (action) {
      history = history.filter(h => h.action === action);
    }
    
    return history
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get system health status
   */
  public getSystemHealth(): {
    totalActions: number;
    activeActions: number;
    averageSuccessRate: number;
    recentAdjustments: number;
    emergencyModeActive: boolean;
  } {
    const metrics = Array.from(this.performanceMetrics.values());
    const totalExecutions = metrics.reduce((sum, m) => sum + m.totalExecutions, 0);
    const successfulExecutions = metrics.reduce((sum, m) => sum + m.successfulExecutions, 0);
    
    const recentAdjustments = this.adjustmentHistory.filter(h => 
      Date.now() - h.timestamp.getTime() < 24 * 60 * 60 * 1000 // within 24 hours
    ).length;

    // Detect if in emergency mode (multiple thresholds adjusted urgently)
    const emergencyAdjustments = this.adjustmentHistory.filter(h =>
      h.triggeredBy === 'emergency' &&
      Date.now() - h.timestamp.getTime() < 60 * 60 * 1000 // within 1 hour
    ).length;

    return {
      totalActions: this.thresholds.size,
      activeActions: metrics.filter(m => m.totalExecutions > 0).length,
      averageSuccessRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 1.0,
      recentAdjustments,
      emergencyModeActive: emergencyAdjustments > 0
    };
  }
}