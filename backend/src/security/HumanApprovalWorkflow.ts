/**
 * Human Approval Workflow - Stage 6 Manual Confirmation Mechanism
 * 
 * Manages high-risk actions that require human approval, providing an approval queue, notifications, and decision tracking.
 */

import { Logger } from '../utils/Logger.js';
import { ActionRiskLevel, ActionSafetyProfile } from './ActionSafetyClassifier.js';

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled'
}

export enum ApprovalUrgency {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ApprovalRequest {
  id: string;
  action: string;
  parameters: any;
  confidence: number;
  safetyProfile: ActionSafetyProfile;
  riskFactors: string[];
  explanation: string;
  requestedBy: string; // Agent or user
  requestedAt: Date;
  expiresAt: Date;
  urgency: ApprovalUrgency;
  status: ApprovalStatus;
  approver?: string;
  approvedAt?: Date;
  rejectionReason?: string;
  executionResult?: any;
  userFeedback?: {
    satisfaction: number; // 1-5
    comments?: string;
  };
}

export interface ApprovalPolicy {
  action: string;
  requiresApproval: boolean;
  approverRoles: string[];
  maxWaitTime: number; // minutes
  autoRejectAfterExpiry: boolean;
  escalationPolicy?: {
    escalateAfterMinutes: number;
    escalateTo: string[];
  };
}

export interface ApprovalNotification {
  requestId: string;
  type: 'new_request' | 'reminder' | 'escalation' | 'decision_made';
  recipient: string;
  message: string;
  sentAt: Date;
  channel: 'email' | 'slack' | 'teams' | 'webhook';
}

export class HumanApprovalWorkflow {
  private logger: Logger;
  private pendingRequests: Map<string, ApprovalRequest>;
  private completedRequests: ApprovalRequest[];
  private approvalPolicies: Map<string, ApprovalPolicy>;
  private notifications: ApprovalNotification[];
  
  private readonly MAX_COMPLETED_REQUESTS = 1000;
  private readonly DEFAULT_EXPIRY_MINUTES = 60;

  constructor() {
    this.logger = new Logger('HumanApprovalWorkflow');
    this.pendingRequests = new Map();
    this.completedRequests = [];
    this.approvalPolicies = new Map();
    this.notifications = [];
    
    this.initializeDefaultPolicies();
    this.startExpirationChecker();
  }

  /**
   * Initialize default approval policies
   */
  private initializeDefaultPolicies(): void {
    const policies: ApprovalPolicy[] = [
      {
        action: 'update_meeting',
        requiresApproval: true,
        approverRoles: ['meeting_organizer', 'team_lead', 'admin'],
        maxWaitTime: 30,
        autoRejectAfterExpiry: false,
        escalationPolicy: {
          escalateAfterMinutes: 15,
          escalateTo: ['team_lead', 'admin']
        }
      },
      {
        action: 'cancel_meeting',
        requiresApproval: true,
        approverRoles: ['meeting_organizer', 'admin'],
        maxWaitTime: 20,
        autoRejectAfterExpiry: false,
        escalationPolicy: {
          escalateAfterMinutes: 10,
          escalateTo: ['admin']
        }
      },
      {
        action: 'send_email',
        requiresApproval: true,
        approverRoles: ['content_reviewer', 'team_lead'],
        maxWaitTime: 45,
        autoRejectAfterExpiry: true
      },
      {
        action: 'send_cancellation_notice',
        requiresApproval: true,
        approverRoles: ['meeting_organizer', 'admin'],
        maxWaitTime: 15,
        autoRejectAfterExpiry: false,
        escalationPolicy: {
          escalateAfterMinutes: 8,
          escalateTo: ['admin']
        }
      },
      {
        action: 'batch_update',
        requiresApproval: true,
        approverRoles: ['admin'],
        maxWaitTime: 60,
        autoRejectAfterExpiry: false,
        escalationPolicy: {
          escalateAfterMinutes: 30,
          escalateTo: ['senior_admin']
        }
      }
    ];

    policies.forEach(policy => {
      this.approvalPolicies.set(policy.action, policy);
    });

    this.logger.info(`Initialized ${policies.length} approval policies`);
  }

  /**
   * Submit an approval request
   */
  public async submitApprovalRequest(
    action: string,
    parameters: any,
    confidence: number,
    safetyProfile: ActionSafetyProfile,
    riskFactors: string[],
    explanation: string,
    requestedBy: string = 'vertex_ai_agent'
  ): Promise<string> {
    
    const policy = this.approvalPolicies.get(action);
    if (!policy || !policy.requiresApproval) {
      throw new Error(`Action ${action} does not require approval`);
    }

    const requestId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.maxWaitTime * 60 * 1000);

    // Determine urgency
    const urgency = this.determineUrgency(safetyProfile.riskLevel, riskFactors, parameters);

    const approvalRequest: ApprovalRequest = {
      id: requestId,
      action,
      parameters,
      confidence,
      safetyProfile,
      riskFactors,
      explanation,
      requestedBy,
      requestedAt: now,
      expiresAt,
      urgency,
      status: ApprovalStatus.PENDING
    };

    // Save the request
    this.pendingRequests.set(requestId, approvalRequest);

    // Notify the appropriate approvers
    await this.notifyApprovers(approvalRequest, policy);

    this.logger.info(`Approval request submitted`, {
      requestId,
      action,
      urgency,
      expiresAt,
      confidence,
      riskFactorsCount: riskFactors.length
    });

    return requestId;
  }

  /**
   * Process an approval decision
   */
  public async processApprovalDecision(
    requestId: string,
    approved: boolean,
    approver: string,
    comments?: string
  ): Promise<boolean> {
    
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      this.logger.error(`Approval request not found: ${requestId}`);
      return false;
    }

    if (request.status !== ApprovalStatus.PENDING) {
      this.logger.warn(`Cannot process decision for non-pending request: ${requestId}`);
      return false;
    }

    // Update request status
    request.status = approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    request.approver = approver;
    request.approvedAt = new Date();
    
    if (!approved && comments) {
      request.rejectionReason = comments;
    }

    // Move to completed requests
    this.moveToCompleted(request);

    // Send decision notification
    await this.notifyDecisionMade(request, approved, comments);

    this.logger.info(`Approval decision processed`, {
      requestId,
      approved,
      approver,
      action: request.action
    });

    return true;
  }

  /**
   * Get pending approval requests
   */
  public getPendingRequests(approverRole?: string): ApprovalRequest[] {
    const requests = Array.from(this.pendingRequests.values());
    
    if (approverRole) {
      return requests.filter(req => {
        const policy = this.approvalPolicies.get(req.action);
        return policy?.approverRoles.includes(approverRole);
      });
    }

    return requests;
  }

  /**
   * Get details of a specific request
   */
  public getRequestDetails(requestId: string): ApprovalRequest | undefined {
    return this.pendingRequests.get(requestId) || 
           this.completedRequests.find(req => req.id === requestId);
  }

  /**
   * Cancel an approval request
   */
  public cancelRequest(requestId: string, reason: string = 'cancelled_by_system'): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return false;
    }

    request.status = ApprovalStatus.CANCELLED;
    request.rejectionReason = reason;
    
    this.moveToCompleted(request);
    
    this.logger.info(`Approval request cancelled`, { requestId, reason });
    return true;
  }

  /**
   * Record execution result and user feedback
   */
  public recordExecutionResult(
    requestId: string,
    executionResult: any,
    userFeedback?: { satisfaction: number; comments?: string }
  ): boolean {
    
    const request = this.completedRequests.find(req => req.id === requestId);
    if (!request) {
      this.logger.error(`Cannot find completed request: ${requestId}`);
      return false;
    }

    request.executionResult = executionResult;
    if (userFeedback) {
      request.userFeedback = userFeedback;
    }

    this.logger.info(`Execution result recorded for approved request`, {
      requestId,
      success: executionResult?.success,
      satisfaction: userFeedback?.satisfaction
    });

    return true;
  }

  /**
   * Determine the urgency of a request
   */
  private determineUrgency(
    riskLevel: ActionRiskLevel,
    riskFactors: string[],
    parameters: any
  ): ApprovalUrgency {
    
    // Based on risk level
    if (riskLevel === ActionRiskLevel.CRITICAL) {
      return ApprovalUrgency.CRITICAL;
    }
    
    if (riskLevel === ActionRiskLevel.HIGH) {
      return ApprovalUrgency.HIGH;
    }

    // Based on the number of risk factors
    if (riskFactors.length >= 3) {
      return ApprovalUrgency.HIGH;
    } else if (riskFactors.length >= 1) {
      return ApprovalUrgency.MEDIUM;
    }

    // Based on parameter content
    if (parameters?.urgent === true) {
      return ApprovalUrgency.HIGH;
    }

    if (parameters?.participants?.length > 20) {
      return ApprovalUrgency.MEDIUM;
    }

    return ApprovalUrgency.LOW;
  }

  /**
   * Notify approvers
   */
  private async notifyApprovers(request: ApprovalRequest, policy: ApprovalPolicy): Promise<void> {
    const message = this.generateApprovalNotificationMessage(request);
    
    for (const approverRole of policy.approverRoles) {
      const notification: ApprovalNotification = {
        requestId: request.id,
        type: 'new_request',
        recipient: approverRole,
        message,
        sentAt: new Date(),
        channel: 'email' // Default channel, should be determined by configuration in a real implementation
      };

      this.notifications.push(notification);
      
      // This should call the actual notification service
      this.logger.info(`Approval notification sent`, {
        requestId: request.id,
        recipient: approverRole,
        urgency: request.urgency
      });
    }
  }

  /**
   * Notify that a decision has been made
   */
  private async notifyDecisionMade(
    request: ApprovalRequest,
    approved: boolean,
    comments?: string
  ): Promise<void> {
    
    const message = `Approval request ${request.id} has been ${approved ? 'approved' : 'rejected'}.` +
                   (comments ? `\nReason: ${comments}` : '');

    const notification: ApprovalNotification = {
      requestId: request.id,
      type: 'decision_made',
      recipient: request.requestedBy,
      message,
      sentAt: new Date(),
      channel: 'email'
    };

    this.notifications.push(notification);
  }

  /**
   * Generate approval notification message
   */
  private generateApprovalNotificationMessage(request: ApprovalRequest): string {
    return `
🔔 SmartMeet AI Agent Approval Request

**Request ID**: ${request.id}
**Action**: ${request.action}
**Risk Level**: ${request.safetyProfile.riskLevel.toUpperCase()}
**Confidence**: ${(request.confidence * 100).toFixed(1)}%
**Urgency**: ${request.urgency.toUpperCase()}

**Explanation**: ${request.explanation}

**Risk Factors**:
${request.riskFactors.map(factor => `• ${factor}`).join('\n')}

**Parameter Details**:
${JSON.stringify(request.parameters, null, 2)}

**Expiration Time**: ${request.expiresAt.toLocaleString()}

Please review this request and make a decision.
    `.trim();
  }

  /**
   * Move a request to the completed list
   */
  private moveToCompleted(request: ApprovalRequest): void {
    this.pendingRequests.delete(request.id);
    this.completedRequests.push(request);

    // Maintain the size limit of completed requests
    if (this.completedRequests.length > this.MAX_COMPLETED_REQUESTS) {
      this.completedRequests = this.completedRequests.slice(-this.MAX_COMPLETED_REQUESTS);
    }
  }

  /**
   * Start the expiration checker
   */
  private startExpirationChecker(): void {
    setInterval(() => {
      this.checkExpiredRequests();
    }, 60000); // Check every minute
  }

  /**
   * Check for expired requests
   */
  private checkExpiredRequests(): void {
    const now = new Date();
    const expiredRequests: ApprovalRequest[] = [];

    this.pendingRequests.forEach((request, requestId) => {
      if (now > request.expiresAt) {
        expiredRequests.push(request);
      }
    });

    for (const request of expiredRequests) {
      const policy = this.approvalPolicies.get(request.action);
      
      if (policy?.autoRejectAfterExpiry) {
        request.status = ApprovalStatus.EXPIRED;
        request.rejectionReason = 'Request expired - auto rejected';
      } else {
        request.status = ApprovalStatus.EXPIRED;
        request.rejectionReason = 'Request expired - requires manual review';
      }

      this.moveToCompleted(request);
      
      this.logger.warn(`Approval request expired`, {
        requestId: request.id,
        action: request.action,
        autoRejected: policy?.autoRejectAfterExpiry
      });
    }

    if (expiredRequests.length > 0) {
      this.logger.info(`Processed ${expiredRequests.length} expired approval requests`);
    }
  }

  /**
   * Get approval statistics
   */
  public getApprovalStats(timeRange?: { start: Date; end: Date }): {
    totalRequests: number;
    pendingRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    expiredRequests: number;
    averageApprovalTime: number;
    approvalsByUrgency: { [key in ApprovalUrgency]: number };
    approvalsByAction: { [action: string]: number };
  } {
    
    let requestsToAnalyze = this.completedRequests;
    
    if (timeRange) {
      requestsToAnalyze = requestsToAnalyze.filter(req =>
        req.requestedAt >= timeRange.start && req.requestedAt <= timeRange.end
      );
    }

    const totalRequests = requestsToAnalyze.length + this.pendingRequests.size;
    const pendingRequests = this.pendingRequests.size;
    const approvedRequests = requestsToAnalyze.filter(req => req.status === ApprovalStatus.APPROVED).length;
    const rejectedRequests = requestsToAnalyze.filter(req => req.status === ApprovalStatus.REJECTED).length;
    const expiredRequests = requestsToAnalyze.filter(req => req.status === ApprovalStatus.EXPIRED).length;

    // Calculate average approval time
    const approvedWithTime = requestsToAnalyze.filter(req => 
      req.status === ApprovalStatus.APPROVED && req.approvedAt
    );
    
    const averageApprovalTime = approvedWithTime.length > 0 
      ? approvedWithTime.reduce((sum, req) => 
          sum + (req.approvedAt!.getTime() - req.requestedAt.getTime()), 0
        ) / approvedWithTime.length / (1000 * 60) // Convert to minutes
      : 0;

    // Group by urgency
    const approvalsByUrgency = {
      [ApprovalUrgency.LOW]: 0,
      [ApprovalUrgency.MEDIUM]: 0,
      [ApprovalUrgency.HIGH]: 0,
      [ApprovalUrgency.CRITICAL]: 0
    };

    // Group by action type
    const approvalsByAction: { [action: string]: number } = {};

    [...requestsToAnalyze, ...Array.from(this.pendingRequests.values())].forEach(req => {
      approvalsByUrgency[req.urgency]++;
      approvalsByAction[req.action] = (approvalsByAction[req.action] || 0) + 1;
    });

    return {
      totalRequests,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      expiredRequests,
      averageApprovalTime,
      approvalsByUrgency,
      approvalsByAction
    };
  }

  /**
   * Get notification history
   */
  public getNotificationHistory(limit: number = 100): ApprovalNotification[] {
    return this.notifications
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }

  /**
   * Update an approval policy
   */
  public updateApprovalPolicy(action: string, policy: Partial<ApprovalPolicy>): boolean {
    const existingPolicy = this.approvalPolicies.get(action);
    if (!existingPolicy) {
      this.logger.error(`Cannot update policy for unknown action: ${action}`);
      return false;
    }

    const updatedPolicy = { ...existingPolicy, ...policy };
    this.approvalPolicies.set(action, updatedPolicy);
    
    this.logger.info(`Updated approval policy for ${action}`, policy);
    return true;
  }

  /**
   * Get all approval policies
   */
  public getAllPolicies(): ApprovalPolicy[] {
    return Array.from(this.approvalPolicies.values());
  }
}
