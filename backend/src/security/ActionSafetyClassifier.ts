/**
 * Action Safety Classifier - Stage 6 Core Security Component
 * 
 * Used to identify and classify the risk levels of various Agent actions, ensuring that high-risk operations receive appropriate security controls.
 */

import { Logger } from '../utils/Logger.js';

export enum ActionRiskLevel {
  LOW = 'low',           // Low risk: query, analysis operations
  MEDIUM = 'medium',     // Medium risk: create documents, send reminders, etc.
  HIGH = 'high',         // High risk: modify meetings, send emails to multiple people
  CRITICAL = 'critical'  // Critical risk: cancel meetings, delete data, etc.
}

export enum ActionCategory {
  READ = 'read',                    // Read operation
  create = 'create',                // Create operation
  update = 'update',                // Update operation  
  delete = 'delete',                // Delete operation
  communication = 'communication',  // Communication operation
  schedule = 'schedule',           // Schedule operation
  analysis = 'analysis'            // Analysis operation
}

export interface ActionSafetyProfile {
  action: string;
  category: ActionCategory;
  riskLevel: ActionRiskLevel;
  requiresApproval: boolean;
  confidenceThreshold: number; // 0-1, can be automatically executed if exceeded
  impactScope: 'self' | 'team' | 'organization' | 'external';
  reversible: boolean; // Whether it can be reversed
  maxAutoExecutions: number; // Maximum number of automatic executions per hour
  reasoningRequired: boolean; // Whether detailed reasoning is required
  auditLevel: 'basic' | 'detailed' | 'comprehensive';
}

export interface ActionClassificationResult {
  action: string;
  safetyProfile: ActionSafetyProfile;
  currentConfidence: number;
  canAutoExecute: boolean;
  requiresApproval: boolean;
  riskFactors: string[];
  mitigationStrategies: string[];
}

export class ActionSafetyClassifier {
  private logger: Logger;
  private safetyProfiles: Map<string, ActionSafetyProfile>;
  private executionCounts: Map<string, { count: number; lastReset: Date }>;

  constructor() {
    this.logger = new Logger('ActionSafetyClassifier');
    this.safetyProfiles = new Map();
    this.executionCounts = new Map();
    this.initializeSafetyProfiles();
  }

  /**
   * Initialize safety profiles for all actions
   */
  private initializeSafetyProfiles(): void {
    const profiles: ActionSafetyProfile[] = [
      // Low-risk operations
      {
        action: 'get_events',
        category: ActionCategory.READ,
        riskLevel: ActionRiskLevel.LOW,
        requiresApproval: false,
        confidenceThreshold: 0.3,
        impactScope: 'self',
        reversible: true,
        maxAutoExecutions: 100,
        reasoningRequired: false,
        auditLevel: 'basic'
      },
      {
        action: 'analyze_conflicts',
        category: ActionCategory.analysis,
        riskLevel: ActionRiskLevel.LOW,
        requiresApproval: false,
        confidenceThreshold: 0.4,
        impactScope: 'self',
        reversible: true,
        maxAutoExecutions: 50,
        reasoningRequired: false,
        auditLevel: 'basic'
      },

      // Medium-risk operations
      {
        action: 'create_document',
        category: ActionCategory.create,
        riskLevel: ActionRiskLevel.MEDIUM,
        requiresApproval: false,
        confidenceThreshold: 0.6,
        impactScope: 'team',
        reversible: true,
        maxAutoExecutions: 20,
        reasoningRequired: true,
        auditLevel: 'detailed'
      },
      {
        action: 'create_agenda',
        category: ActionCategory.create,
        riskLevel: ActionRiskLevel.MEDIUM,
        requiresApproval: false,
        confidenceThreshold: 0.65,
        impactScope: 'team',
        reversible: true,
        maxAutoExecutions: 15,
        reasoningRequired: true,
        auditLevel: 'detailed'
      },
      {
        action: 'send_reminder',
        category: ActionCategory.communication,
        riskLevel: ActionRiskLevel.MEDIUM,
        requiresApproval: false,
        confidenceThreshold: 0.7,
        impactScope: 'team',
        reversible: false,
        maxAutoExecutions: 10,
        reasoningRequired: true,
        auditLevel: 'detailed'
      },

      // High-risk operations
      {
        action: 'update_meeting',
        category: ActionCategory.update,
        riskLevel: ActionRiskLevel.HIGH,
        requiresApproval: true,
        confidenceThreshold: 0.8,
        impactScope: 'team',
        reversible: true,
        maxAutoExecutions: 5,
        reasoningRequired: true,
        auditLevel: 'comprehensive'
      },
      {
        action: 'send_email',
        category: ActionCategory.communication,
        riskLevel: ActionRiskLevel.HIGH,
        requiresApproval: true,
        confidenceThreshold: 0.75,
        impactScope: 'team',
        reversible: false,
        maxAutoExecutions: 8,
        reasoningRequired: true,
        auditLevel: 'comprehensive'
      },
      {
        action: 'batch_update',
        category: ActionCategory.update,
        riskLevel: ActionRiskLevel.HIGH,
        requiresApproval: true,
        confidenceThreshold: 0.85,
        impactScope: 'organization',
        reversible: true,
        maxAutoExecutions: 2,
        reasoningRequired: true,
        auditLevel: 'comprehensive'
      },

      // Critical-risk operations
      {
        action: 'cancel_meeting',
        category: ActionCategory.delete,
        riskLevel: ActionRiskLevel.CRITICAL,
        requiresApproval: true,
        confidenceThreshold: 0.9,
        impactScope: 'team',
        reversible: false,
        maxAutoExecutions: 3,
        reasoningRequired: true,
        auditLevel: 'comprehensive'
      },
      {
        action: 'send_cancellation_notice',
        category: ActionCategory.communication,
        riskLevel: ActionRiskLevel.CRITICAL,
        requiresApproval: true,
        confidenceThreshold: 0.88,
        impactScope: 'external',
        reversible: false,
        maxAutoExecutions: 2,
        reasoningRequired: true,
        auditLevel: 'comprehensive'
      },
      {
        action: 'send_meeting_invite',
        category: ActionCategory.communication,
        riskLevel: ActionRiskLevel.HIGH,
        requiresApproval: true,
        confidenceThreshold: 0.8,
        impactScope: 'external',
        reversible: false,
        maxAutoExecutions: 5,
        reasoningRequired: true,
        auditLevel: 'comprehensive'
      }
    ];

    // Register all safety profiles
    profiles.forEach(profile => {
      this.safetyProfiles.set(profile.action, profile);
      this.logger.info(`Registered safety profile for action: ${profile.action}`, {
        riskLevel: profile.riskLevel,
        requiresApproval: profile.requiresApproval,
        confidenceThreshold: profile.confidenceThreshold
      });
    });

    this.logger.info(`Initialized ${profiles.length} action safety profiles`);
  }

  /**
   * Classify and assess the safety of an action
   */
  public classifyAction(
    action: string,
    confidence: number,
    context?: any
  ): ActionClassificationResult {
    const safetyProfile = this.safetyProfiles.get(action);
    
    if (!safetyProfile) {
      // Default to high risk for unknown actions
      this.logger.warn(`Unknown action classification: ${action}, defaulting to HIGH risk`);
      return {
        action,
        safetyProfile: {
          action,
          category: ActionCategory.update,
          riskLevel: ActionRiskLevel.HIGH,
          requiresApproval: true,
          confidenceThreshold: 0.9,
          impactScope: 'team',
          reversible: false,
          maxAutoExecutions: 1,
          reasoningRequired: true,
          auditLevel: 'comprehensive'
        },
        currentConfidence: confidence,
        canAutoExecute: false,
        requiresApproval: true,
        riskFactors: ['Unknown action type'],
        mitigationStrategies: ['Require manual approval for unknown actions']
      };
    }

    // Check execution frequency limits
    const canExecuteByFrequency = this.checkExecutionFrequency(action, safetyProfile);
    
    // Identify risk factors
    const riskFactors = this.identifyRiskFactors(action, confidence, context, safetyProfile);
    
    // Generate mitigation strategies
    const mitigationStrategies = this.generateMitigationStrategies(safetyProfile, riskFactors);
    
    // Determine if it can be automatically executed
    const meetsConfidenceThreshold = confidence >= safetyProfile.confidenceThreshold;
    const canAutoExecute = meetsConfidenceThreshold && 
                          canExecuteByFrequency && 
                          !safetyProfile.requiresApproval &&
                          riskFactors.length === 0;

    const requiresApproval = safetyProfile.requiresApproval || 
                           !meetsConfidenceThreshold || 
                           !canExecuteByFrequency ||
                           riskFactors.length > 0;

    this.logger.info(`Action classification completed`, {
      action,
      riskLevel: safetyProfile.riskLevel,
      confidence,
      confidenceThreshold: safetyProfile.confidenceThreshold,
      canAutoExecute,
      requiresApproval,
      riskFactors: riskFactors.length
    });

    return {
      action,
      safetyProfile,
      currentConfidence: confidence,
      canAutoExecute,
      requiresApproval,
      riskFactors,
      mitigationStrategies
    };
  }

  /**
   * Check if the action execution frequency is within the allowed range
   */
  private checkExecutionFrequency(action: string, profile: ActionSafetyProfile): boolean {
    const now = new Date();
    const executionData = this.executionCounts.get(action);

    if (!executionData) {
      // First execution
      this.executionCounts.set(action, { count: 0, lastReset: now });
      return true;
    }

    // Check if the counter needs to be reset (reset every hour)
    const hoursSinceReset = (now.getTime() - executionData.lastReset.getTime()) / (1000 * 60 * 60);
    if (hoursSinceReset >= 1) {
      this.executionCounts.set(action, { count: 0, lastReset: now });
      return true;
    }

    // Check if the limit is exceeded
    return executionData.count < profile.maxAutoExecutions;
  }

  /**
   * Record an action execution (for frequency control)
   */
  public recordExecution(action: string): void {
    const executionData = this.executionCounts.get(action);
    if (executionData) {
      executionData.count++;
    } else {
      this.executionCounts.set(action, { count: 1, lastReset: new Date() });
    }
  }

  /**
   * Identify risk factors for a specific action
   */
  private identifyRiskFactors(
    action: string, 
    confidence: number, 
    context: any, 
    profile: ActionSafetyProfile
  ): string[] {
    const factors: string[] = [];

    // Confidence risk
    if (confidence < profile.confidenceThreshold) {
      factors.push(`Low confidence: ${confidence.toFixed(2)} < ${profile.confidenceThreshold}`);
    }

    // Context-related risks
    if (context) {
      // Participant count risk
      if (context.participants && context.participants.length > 10) {
        factors.push('High participant count (>10)');
      }

      // External participant risk
      if (context.participants && context.participants.some((p: any) => 
        typeof p === 'string' ? !p.includes('@company.com') : !p.email?.includes('@company.com'))) {
        factors.push('External participants involved');
      }

      // Time sensitivity
      if (context.urgent === true) {
        factors.push('Urgent operation - higher risk of mistakes');
      }

      // Batch operation risk
      if (context.batchSize && context.batchSize > 5) {
        factors.push(`Batch operation affecting ${context.batchSize} items`);
      }
    }

    // Time-related risks
    const hour = new Date().getHours();
    if (hour < 8 || hour > 18) {
      factors.push('Operation outside business hours');
    }

    return factors;
  }

  /**
   * Generate risk mitigation strategies
   */
  private generateMitigationStrategies(
    profile: ActionSafetyProfile, 
    riskFactors: string[]
  ): string[] {
    const strategies: string[] = [];

    if (riskFactors.length > 0) {
      strategies.push('Require human approval due to identified risk factors');
    }

    if (profile.riskLevel === ActionRiskLevel.HIGH || profile.riskLevel === ActionRiskLevel.CRITICAL) {
      strategies.push('Generate detailed explanation for high-risk action');
      strategies.push('Log comprehensive audit trail');
    }

    if (!profile.reversible) {
      strategies.push('Extra confirmation required for irreversible action');
    }

    if (profile.impactScope === 'external' || profile.impactScope === 'organization') {
      strategies.push('Senior approval required for wide-impact operations');
    }

    return strategies;
  }

  /**
   * Get all safety profiles
   */
  public getAllSafetyProfiles(): ActionSafetyProfile[] {
    return Array.from(this.safetyProfiles.values());
  }

  /**
   * Get the safety profile for a specific action
   */
  public getSafetyProfile(action: string): ActionSafetyProfile | undefined {
    return this.safetyProfiles.get(action);
  }

  /**
   * Update the safety threshold for an action (learning mechanism)
   */
  public updateSafetyProfile(action: string, updates: Partial<ActionSafetyProfile>): boolean {
    const profile = this.safetyProfiles.get(action);
    if (!profile) {
      this.logger.warn(`Cannot update unknown action profile: ${action}`);
      return false;
    }

    const updatedProfile = { ...profile, ...updates };
    this.safetyProfiles.set(action, updatedProfile);
    
    this.logger.info(`Updated safety profile for action: ${action}`, updates);
    return true;
  }

  /**
   * Get execution statistics
   */
  public getExecutionStats(): { [action: string]: { count: number; lastReset: Date } } {
    const stats: { [action: string]: { count: number; lastReset: Date } } = {};
    
    this.executionCounts.forEach((value, key) => {
      stats[key] = { ...value };
    });
    
    return stats;
  }

  /**
   * Reset execution counters
   */
  public resetExecutionCounts(action?: string): void {
    if (action) {
      this.executionCounts.delete(action);
      this.logger.info(`Reset execution count for action: ${action}`);
    } else {
      this.executionCounts.clear();
      this.logger.info('Reset all execution counts');
    }
  }
}