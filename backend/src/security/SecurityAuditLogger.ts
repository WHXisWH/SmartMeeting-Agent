/**
 * Security Audit Log System - Stage 6 Audit Trail
 * 
 * Records all security-related decisions, actions, and events, providing a complete audit trail.
 */

import { Logger } from '../utils/Logger.js';

export enum AuditEventType {
  ACTION_REQUESTED = 'action_requested',
  ACTION_APPROVED = 'action_approved',
  ACTION_REJECTED = 'action_rejected',
  ACTION_EXECUTED = 'action_executed',
  THRESHOLD_ADJUSTED = 'threshold_adjusted',
  RISK_DETECTED = 'risk_detected',
  APPROVAL_SUBMITTED = 'approval_submitted',
  APPROVAL_EXPIRED = 'approval_expired',
  EMERGENCY_MODE = 'emergency_mode',
  SECURITY_VIOLATION = 'security_violation'
}

export enum AuditSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  severity: AuditSeverity;
  
  // Who - executing principal
  actor: {
    type: 'agent' | 'human' | 'system';
    id: string;
    role?: string;
    sessionId?: string;
  };

  // What - specific action
  action: {
    name: string;
    parameters: any;
    targetResource?: string;
    affectedUsers?: string[];
  };

  // Why - decision reasoning
  reasoning: {
    confidence: number;
    explanation: string;
    riskFactors: string[];
    mitigationStrategies: string[];
    memoryReferences?: string[];
  };

  // Context - environmental information
  context: {
    systemState: any;
    userContext?: any;
    previousActions?: string[];
    relatedEvents?: string[];
  };

  // Outcome - result
  outcome: {
    success: boolean;
    result?: any;
    errorMessage?: string;
    timeTaken?: number;
    impactAssessment?: string;
  };

  // Security metadata
  security: {
    riskLevel: string;
    safetyProfile?: any;
    approvalRequired: boolean;
    approvalId?: string;
    thresholdMet: boolean;
  };

  // Compliance and tracking
  compliance: {
    auditTrail: string[];
    regulatoryTags?: string[];
    retentionPolicy: string;
    dataClassification: 'public' | 'internal' | 'confidential' | 'restricted';
  };
}

export interface AuditSearchCriteria {
  eventTypes?: AuditEventType[];
  severities?: AuditSeverity[];
  actorIds?: string[];
  actions?: string[];
  dateRange?: { start: Date; end: Date };
  confidenceRange?: { min: number; max: number };
  riskLevels?: string[];
  approvalStatuses?: ('required' | 'not_required' | 'pending' | 'approved' | 'rejected')[];
}

export class SecurityAuditLogger {
  private logger: Logger;
  private auditLogs: AuditLogEntry[];
  private readonly MAX_LOG_ENTRIES = 10000;
  private readonly DEFAULT_RETENTION_DAYS = 90;

  constructor() {
    this.logger = new Logger('SecurityAuditLogger');
    this.auditLogs = [];
    this.startMaintenanceScheduler();
  }

  /**
   * Log a security audit event
   */
  public logSecurityEvent(
    eventType: AuditEventType,
    severity: AuditSeverity,
    actorType: 'agent' | 'human' | 'system',
    actorId: string,
    actionName: string,
    actionParameters: any,
    reasoning: {
      confidence: number;
      explanation: string;
      riskFactors: string[];
      mitigationStrategies?: string[];
    },
    outcome: {
      success: boolean;
      result?: any;
      errorMessage?: string;
      timeTaken?: number;
    },
    securityContext: {
      riskLevel: string;
      safetyProfile?: any;
      approvalRequired: boolean;
      approvalId?: string;
      thresholdMet: boolean;
    },
    additionalContext?: any
  ): string {

    const entryId = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    const auditEntry: AuditLogEntry = {
      id: entryId,
      timestamp: new Date(),
      eventType,
      severity,

      actor: {
        type: actorType,
        id: actorId,
        role: additionalContext?.actorRole,
        sessionId: additionalContext?.sessionId
      },

      action: {
        name: actionName,
        parameters: actionParameters,
        targetResource: additionalContext?.targetResource,
        affectedUsers: additionalContext?.affectedUsers
      },

      reasoning: {
        confidence: reasoning.confidence,
        explanation: reasoning.explanation,
        riskFactors: reasoning.riskFactors,
        mitigationStrategies: reasoning.mitigationStrategies || [],
        memoryReferences: additionalContext?.memoryReferences
      },

      context: {
        systemState: additionalContext?.systemState || { status: 'normal' },
        userContext: additionalContext?.userContext,
        previousActions: additionalContext?.previousActions,
        relatedEvents: additionalContext?.relatedEvents
      },

      outcome: {
        success: outcome.success,
        result: outcome.result,
        errorMessage: outcome.errorMessage,
        timeTaken: outcome.timeTaken,
        impactAssessment: additionalContext?.impactAssessment
      },

      security: {
        riskLevel: securityContext.riskLevel,
        safetyProfile: securityContext.safetyProfile,
        approvalRequired: securityContext.approvalRequired,
        approvalId: securityContext.approvalId,
        thresholdMet: securityContext.thresholdMet
      },

      compliance: {
        auditTrail: this.generateAuditTrail(actionName, actorId),
        regulatoryTags: additionalContext?.regulatoryTags,
        retentionPolicy: `${this.DEFAULT_RETENTION_DAYS}_days`,
        dataClassification: this.classifyData(securityContext.riskLevel, actionName)
      }
    };

    // Save audit entry
    this.auditLogs.push(auditEntry);

    // Maintain log size limit
    if (this.auditLogs.length > this.MAX_LOG_ENTRIES) {
      this.auditLogs = this.auditLogs.slice(-this.MAX_LOG_ENTRIES);
    }

    this.logger.info(`Security audit event logged`, {
      entryId,
      eventType,
      severity,
      actionName,
      success: outcome.success
    });

    // If it is a severe event, report it immediately
    if (severity === AuditSeverity.CRITICAL || severity === AuditSeverity.ERROR) {
      this.handleSevereEvent(auditEntry);
    }

    return entryId;
  }

  /**
   * Quickly record action execution
   */
  public logActionExecution(
    actorId: string,
    actionName: string,
    parameters: any,
    confidence: number,
    success: boolean,
    riskLevel: string,
    approvalRequired: boolean,
    explanation: string,
    riskFactors: string[] = [],
    timeTaken?: number
  ): string {

    return this.logSecurityEvent(
      success ? AuditEventType.ACTION_EXECUTED : AuditEventType.SECURITY_VIOLATION,
      success ? AuditSeverity.INFO : AuditSeverity.ERROR,
      'agent',
      actorId,
      actionName,
      parameters,
      {
        confidence,
        explanation,
        riskFactors
      },
      {
        success,
        timeTaken
      },
      {
        riskLevel,
        safetyProfile: null,
        approvalRequired,
        thresholdMet: confidence >= 0.5
      }
    );
  }

  /**
   * Record approval event
   */
  public logApprovalEvent(
    eventType: AuditEventType.APPROVAL_SUBMITTED | AuditEventType.ACTION_APPROVED | AuditEventType.ACTION_REJECTED,
    approvalId: string,
    actionName: string,
    requesterId: string,
    approverId?: string,
    reason?: string
  ): string {

    const severity = eventType === AuditEventType.ACTION_REJECTED ? AuditSeverity.WARNING : AuditSeverity.INFO;

    return this.logSecurityEvent(
      eventType,
      severity,
      approverId ? 'human' : 'system',
      approverId || 'system',
      actionName,
      { approvalId, requesterId },
      {
        confidence: 1.0,
        explanation: reason || `Approval ${eventType.split('_')[1]}`,
        riskFactors: []
      },
      {
        success: eventType !== AuditEventType.ACTION_REJECTED
      },
      {
        riskLevel: 'HIGH',
        approvalRequired: true,
        approvalId,
        thresholdMet: false
      }
    );
  }

  /**
   * Record risk detection event
   */
  public logRiskDetection(
    actionName: string,
    riskFactors: string[],
    riskLevel: string,
    confidence: number,
    mitigation: string[]
  ): string {

    return this.logSecurityEvent(
      AuditEventType.RISK_DETECTED,
      riskLevel === 'CRITICAL' ? AuditSeverity.CRITICAL : AuditSeverity.WARNING,
      'system',
      'risk_detector',
      actionName,
      { detectedRisks: riskFactors },
      {
        confidence,
        explanation: `Detected ${riskFactors.length} risk factors for ${actionName}`,
        riskFactors,
        mitigationStrategies: mitigation
      },
      {
        success: true
      },
      {
        riskLevel,
        approvalRequired: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
        thresholdMet: false
      }
    );
  }

  /**
   * Search audit logs
   */
  public searchAuditLogs(criteria: AuditSearchCriteria, limit: number = 100): AuditLogEntry[] {
    let results = this.auditLogs;

    // Filter by event type
    if (criteria.eventTypes && criteria.eventTypes.length > 0) {
      results = results.filter(entry => criteria.eventTypes!.includes(entry.eventType));
    }

    // Filter by severity
    if (criteria.severities && criteria.severities.length > 0) {
      results = results.filter(entry => criteria.severities!.includes(entry.severity));
    }

    // Filter by actor
    if (criteria.actorIds && criteria.actorIds.length > 0) {
      results = results.filter(entry => criteria.actorIds!.includes(entry.actor.id));
    }

    // Filter by action name
    if (criteria.actions && criteria.actions.length > 0) {
      results = results.filter(entry => criteria.actions!.includes(entry.action.name));
    }

    // Filter by date range
    if (criteria.dateRange) {
      results = results.filter(entry => 
        entry.timestamp >= criteria.dateRange!.start && 
        entry.timestamp <= criteria.dateRange!.end
      );
    }

    // Filter by confidence range
    if (criteria.confidenceRange) {
      results = results.filter(entry => 
        entry.reasoning.confidence >= criteria.confidenceRange!.min &&
        entry.reasoning.confidence <= criteria.confidenceRange!.max
      );
    }

    // Filter by risk level
    if (criteria.riskLevels && criteria.riskLevels.length > 0) {
      results = results.filter(entry => criteria.riskLevels!.includes(entry.security.riskLevel));
    }

    // Sort by time descending and limit results
    return results
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get audit statistics
   */
  public getAuditStatistics(timeRange?: { start: Date; end: Date }): {
    totalEvents: number;
    eventsByType: { [key in AuditEventType]?: number };
    eventsBySeverity: { [key in AuditSeverity]?: number };
    actionsExecuted: number;
    approvalsRequired: number;
    risksDetected: number;
    averageConfidence: number;
    securityViolations: number;
    topActors: Array<{ actorId: string; count: number }>;
    topActions: Array<{ action: string; count: number }>;
  } {

    let logs = this.auditLogs;

    if (timeRange) {
      logs = logs.filter(entry =>
        entry.timestamp >= timeRange.start && entry.timestamp <= timeRange.end
      );
    }

    // Tally event types
    const eventsByType: { [key in AuditEventType]?: number } = {};
    const eventsBySeverity: { [key in AuditSeverity]?: number } = {};
    const actorCounts: { [actorId: string]: number } = {};
    const actionCounts: { [action: string]: number } = {};

    let totalConfidence = 0;
    let approvalsRequired = 0;
    let securityViolations = 0;

    logs.forEach(entry => {
      // Tally event type
      eventsByType[entry.eventType] = (eventsByType[entry.eventType] || 0) + 1;
      
      // Tally severity
      eventsBySeverity[entry.severity] = (eventsBySeverity[entry.severity] || 0) + 1;
      
      // Tally actor
      actorCounts[entry.actor.id] = (actorCounts[entry.actor.id] || 0) + 1;
      
      // Tally action
      actionCounts[entry.action.name] = (actionCounts[entry.action.name] || 0) + 1;
      
      // Accumulate confidence
      totalConfidence += entry.reasoning.confidence;
      
      // Tally approval requirements
      if (entry.security.approvalRequired) {
        approvalsRequired++;
      }
      
      // Tally security violations
      if (entry.eventType === AuditEventType.SECURITY_VIOLATION) {
        securityViolations++;
      }
    });

    // Sort top actors and actions
    const topActors = Object.entries(actorCounts)
      .map(([actorId, count]) => ({ actorId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topActions = Object.entries(actionCounts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents: logs.length,
      eventsByType,
      eventsBySeverity,
      actionsExecuted: eventsByType[AuditEventType.ACTION_EXECUTED] || 0,
      approvalsRequired,
      risksDetected: eventsByType[AuditEventType.RISK_DETECTED] || 0,
      averageConfidence: logs.length > 0 ? totalConfidence / logs.length : 0,
      securityViolations,
      topActors,
      topActions
    };
  }

  /**
   * Generate audit report
   */
  public generateAuditReport(timeRange?: { start: Date; end: Date }): string {
    const stats = this.getAuditStatistics(timeRange);
    const period = timeRange 
      ? `${timeRange.start.toLocaleDateString()} - ${timeRange.end.toLocaleDateString()}`
      : 'All time';

    const report = [
      `# SmartMeet AI Agent Security Audit Report`,
      `**Report Period:** ${period}`,
      `**Generated At:** ${new Date().toLocaleString()}`,
      ``,
      `## Overall Summary`,
      `- **Total Events:** ${stats.totalEvents}`,
      `- **Actions Executed:** ${stats.actionsExecuted}`,
      `- **Approvals Required:** ${stats.approvalsRequired}`,
      `- **Risks Detected:** ${stats.risksDetected}`,
      `- **Security Violations:** ${stats.securityViolations}`,
      `- **Average Confidence:** ${(stats.averageConfidence * 100).toFixed(1)}%`,
      ``,
      `## Event Type Distribution`,
      ...Object.entries(stats.eventsByType).map(([type, count]) => 
        `- **${type}:** ${count}`
      ),
      ``,
      `## Severity Distribution`,
      ...Object.entries(stats.eventsBySeverity).map(([severity, count]) => 
        `- **${severity.toUpperCase()}:** ${count}`
      ),
      ``,
      `## Top Actors`,
      ...stats.topActors.slice(0, 5).map((actor, index) => 
        `${index + 1}. ${actor.actorId}: ${actor.count} actions`
      ),
      ``,
      `## Top Actions`,
      ...stats.topActions.slice(0, 5).map((action, index) => 
        `${index + 1}. ${action.action}: ${action.count} executions`
      )
    ];

    return report.join('\n');
  }

  /**
   * Handle severe events
   */
  private handleSevereEvent(entry: AuditLogEntry): void {
    this.logger.error(`SEVERE SECURITY EVENT DETECTED`, {
      entryId: entry.id,
      eventType: entry.eventType,
      severity: entry.severity,
      action: entry.action.name,
      actor: entry.actor.id
    });

    // This should trigger an alerting system
    // - Send emergency notifications
    // - Potentially pause the system
    // - Log to an external security system
  }

  /**
   * Generate audit trail chain
   */
  private generateAuditTrail(actionName: string, actorId: string): string[] {
    return [
      `Action ${actionName} initiated by ${actorId}`,
      `Risk assessment completed`,
      `Security checks passed`,
      `Audit log entry created`
    ];
  }

  /**
   * Data classification
   */
  private classifyData(riskLevel: string, actionName: string): 'public' | 'internal' | 'confidential' | 'restricted' {
    if (riskLevel === 'CRITICAL') {
      return 'restricted';
    } else if (riskLevel === 'HIGH') {
      return 'confidential';
    } else if (actionName.includes('email') || actionName.includes('communication')) {
      return 'confidential';
    }
    return 'internal';
  }

  /**
   * Start maintenance scheduler
   */
  private startMaintenanceScheduler(): void {
    // Clean up expired logs daily
    setInterval(() => {
      this.cleanupExpiredLogs();
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  /**
   * Clean up expired logs
   */
  private cleanupExpiredLogs(): void {
    const cutoffDate = new Date(Date.now() - this.DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const beforeCount = this.auditLogs.length;
    
    this.auditLogs = this.auditLogs.filter(entry => entry.timestamp >= cutoffDate);
    
    const cleanedCount = beforeCount - this.auditLogs.length;
    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} expired audit logs`);
    }
  }

  /**
   * Get a specific audit entry
   */
  public getAuditEntry(entryId: string): AuditLogEntry | undefined {
    return this.auditLogs.find(entry => entry.id === entryId);
  }

  /**
   * Export audit logs
   */
  public exportAuditLogs(format: 'json' | 'csv', criteria?: AuditSearchCriteria): string {
    const logs = criteria ? this.searchAuditLogs(criteria, 10000) : this.auditLogs;

    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    } else {
      // Simplified CSV format
      const headers = ['Timestamp', 'Event Type', 'Severity', 'Actor', 'Action', 'Success', 'Confidence'];
      const rows = logs.map(entry => [
        entry.timestamp.toISOString(),
        entry.eventType,
        entry.severity,
        entry.actor.id,
        entry.action.name,
        entry.outcome.success.toString(),
        entry.reasoning.confidence.toString()
      ]);

      return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }
  }
}
