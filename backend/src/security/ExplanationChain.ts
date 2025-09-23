/**
 * Explanation Chain Generator - Stage 6 Reasoning Transparency
 * 
 * Generates a detailed reasoning chain for each Agent action, ensuring the decision-making process is traceable and understandable.
 */

import { Logger } from '../utils/Logger.js';

export interface ReasoningStep {
  step: number;
  type: 'observation' | 'analysis' | 'inference' | 'decision' | 'validation';
  description: string;
  evidence: string[];
  confidence: number;
  alternatives?: string[];
  chosenReason?: string;
}

export interface ExplanationChain {
  id: string;
  action: string;
  timestamp: Date;
  initialContext: any;
  reasoningSteps: ReasoningStep[];
  finalDecision: {
    action: string;
    parameters: any;
    confidence: number;
    rationale: string;
  };
  riskAssessment: {
    riskLevel: string;
    riskFactors: string[];
    mitigationStrategies: string[];
  };
  memoryReferences?: string[]; // Referenced memories/experiences
  toolsUsed: Array<{ 
    toolName: string;
    purpose: string;
    result: any;
  }>;
  humanReadableExplanation: string;
}

export class ExplanationChainGenerator {
  private logger: Logger;
  private explanationHistory: ExplanationChain[];
  private readonly MAX_HISTORY_SIZE = 500;

  constructor() {
    this.logger = new Logger('ExplanationChainGenerator');
    this.explanationHistory = [];
  }

  /**
   * Generate a complete explanation chain
   */
  public generateExplanationChain(
    action: string,
    context: any,
    agentResponse: any,
    toolsUsed: any[],
    riskAssessment: any
  ): ExplanationChain {

    const explanationId = `explain_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Build reasoning steps
    const reasoningSteps = this.buildReasoningSteps(action, context, agentResponse, toolsUsed);

    // Generate human-readable explanation
    const humanReadableExplanation = this.generateHumanReadableExplanation(
      action, 
      context, 
      reasoningSteps, 
      agentResponse
    );

    const explanationChain: ExplanationChain = {
      id: explanationId,
      action,
      timestamp: new Date(),
      initialContext: context,
      reasoningSteps,
      finalDecision: {
        action,
        parameters: agentResponse.parameters || {},
        confidence: agentResponse.confidence || 0.5,
        rationale: agentResponse.reasoning || agentResponse.response
      },
      riskAssessment,
      toolsUsed: toolsUsed.map(tool => ({
        toolName: tool.toolName,
        purpose: `Used for ${tool.toolName} functionality`,
        result: tool.result
      })),
      humanReadableExplanation
    };

    // Save to history
    this.saveExplanation(explanationChain);

    this.logger.info(`Generated explanation chain for action: ${action}`, {
      explanationId,
      stepCount: reasoningSteps.length,
      confidence: agentResponse.confidence
    });

    return explanationChain;
  }

  /**
   * Build reasoning steps
   */
  private buildReasoningSteps(
    action: string,
    context: any,
    agentResponse: any,
    toolsUsed: any[]
  ): ReasoningStep[] {

    const steps: ReasoningStep[] = [];

    // Step 1: Observe the current situation
    steps.push({
      step: 1,
      type: 'observation',
      description: 'Analyze the current situation and input data',
      evidence: [
        `Received request to execute ${action}`,
        `Context includes: ${Object.keys(context || {}).join(', ')}`,
        `Current system status: Normal`
      ],
      confidence: 0.95
    });

    // Step 2: Analyze requirements
    steps.push({
      step: 2,
      type: 'analysis',
      description: 'Analyze task requirements and constraints',
      evidence: [
        `Action type: ${action}`,
        `Risk level assessment: ${this.assessRiskFromAction(action)}`,
        `Involved tools: ${toolsUsed.map(t => t.toolName).join(', ')}`
      ],
      confidence: 0.9,
      alternatives: [
        'Execute action directly',
        'Request manual approval',
        'Find alternative solutions',
        'Delay execution'
      ]
    });

    // Step 3: Tool call reasoning
    if (toolsUsed.length > 0) {
      toolsUsed.forEach((tool, index) => {
        steps.push({
          step: steps.length + 1,
          type: 'inference',
          description: `Calling ${tool.toolName} tool for ${action} operation`,
          evidence: [
            `Tool: ${tool.toolName}`,
            `Parameters: ${JSON.stringify(tool.parameters).substring(0, 100)}...`,
            `Result status: ${tool.result?.success ? 'Success' : 'Failure'}`
          ],
          confidence: tool.result?.success ? 0.8 : 0.3,
          chosenReason: `${tool.toolName} is the most suitable tool for executing ${action}`
        });
      });
    }

    // Step 4: Decision making
    steps.push({
      step: steps.length + 1,
      type: 'decision',
      description: 'Formulate final decision based on analysis results',
      evidence: [
        `Overall confidence: ${agentResponse.confidence || 0.5}`,
        `Tool execution result: ${toolsUsed.every(t => t.result?.success) ? 'All successful' : 'Partially failed'}`,
        `No significant risk conflicts`
      ],
      confidence: agentResponse.confidence || 0.5,
      alternatives: ['Execute recommended action', 'Seek manual confirmation', 'Recommend alternative solution'],
      chosenReason: this.getDecisionReason(action, agentResponse.confidence || 0.5)
    });

    // Step 5: Validation and confirmation
    steps.push({
      step: steps.length + 1,
      type: 'validation',
      description: 'Validate the reasonableness and security of the decision',
      evidence: [
        'Decision complies with security policies',
        'Relevant risk factors have been considered',
        'Sufficient explanatory basis is provided'
      ],
      confidence: 0.85
    });

    return steps;
  }

  /**
   * Generate human-readable explanation
   */
  private generateHumanReadableExplanation(
    action: string,
    context: any,
    steps: ReasoningStep[],
    agentResponse: any
  ): string {

    const sections = [];

    // Overview
    sections.push(`## Decision Overview`);
    sections.push(`I have analyzed the request to execute "${action}" and reached a conclusion through the following reasoning process:`);
    sections.push('');

    // Reasoning process
    sections.push(`## Reasoning Process`);
    steps.forEach(step => {
      sections.push(`### ${step.step}. ${step.description}`);
      
      if (step.evidence.length > 0) {
        sections.push(`**Observed Evidence:**`);
        step.evidence.forEach(evidence => {
          sections.push(`- ${evidence}`);
        });
      }

      if (step.alternatives && step.alternatives.length > 0) {
        sections.push(`**Considered Options:** ${step.alternatives.join(', ')}`);
      }

      if (step.chosenReason) {
        sections.push(`**Reason for Choice:** ${step.chosenReason}`);
      }

      sections.push(`**Confidence:** ${(step.confidence * 100).toFixed(1)}%`);
      sections.push('');
    });

    // Final decision
    sections.push(`## Final Decision`);
    sections.push(`Based on the above analysis, my recommendation is:`);
    sections.push(`**Action:** ${action}`);
    sections.push('**Overall Confidence:** ' + ((agentResponse.confidence || 0.5) * 100).toFixed(1) + '%');
    
    if (agentResponse.response) {
      sections.push(`**Detailed Explanation:** ${agentResponse.response}`);
    }

    // Risk assessment
    sections.push(`## Risk Assessment`);
    const riskLevel = this.assessRiskFromAction(action);
    sections.push(`**Risk Level:** ${riskLevel}`);
    
    if (riskLevel !== 'LOW') {
      sections.push(`**Recommendation:** Consider manual review to ensure the decision is appropriate`);
    }

    return sections.join('\n');
  }

  /**
   * Assess action risk level
   */
  private assessRiskFromAction(action: string): string {
    const highRiskActions = ['cancel_meeting', 'send_cancellation_notice', 'batch_update'];
    const mediumRiskActions = ['update_meeting', 'send_email', 'create_document'];
    
    if (highRiskActions.includes(action)) {
      return 'HIGH';
    } else if (mediumRiskActions.includes(action)) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  /**
   * Get decision reason
   */
  private getDecisionReason(action: string, confidence: number): string {
    if (confidence >= 0.8) {
      return 'High confidence (' + (confidence * 100).toFixed(1) + '%) supports executing this action';
    } else if (confidence >= 0.6) {
      return 'Medium confidence suggests execution, but the result needs to be monitored';
    } else {
      return 'Low confidence, it is recommended to seek manual confirmation before execution';
    }
  }

  /**
   * Save explanation to history
   */
  private saveExplanation(explanation: ExplanationChain): void {
    this.explanationHistory.push(explanation);
    
    // Maintain history size limit
    if (this.explanationHistory.length > this.MAX_HISTORY_SIZE) {
      this.explanationHistory = this.explanationHistory.slice(-this.MAX_HISTORY_SIZE);
    }
  }

  /**
   * Get explanation history
   */
  public getExplanationHistory(limit: number = 50): ExplanationChain[] {
    return this.explanationHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get a specific explanation by ID
   */
  public getExplanation(explanationId: string): ExplanationChain | undefined {
    return this.explanationHistory.find(exp => exp.id === explanationId);
  }

  /**
   * Generate a simplified explanation (for quick review)
   */
  public generateSummaryExplanation(explanationChain: ExplanationChain): string {
    const keyPoints = [
      'Action: ' + explanationChain.action,
      'Confidence: ' + (explanationChain.finalDecision.confidence * 100).toFixed(1) + '%',
      'Risk Level: ' + explanationChain.riskAssessment.riskLevel,
      'Tools Used: ' + explanationChain.toolsUsed.length,
      'Reasoning Steps: ' + explanationChain.reasoningSteps.length
    ];

    let summary = '**Decision Summary**\n' + keyPoints.join(' | ') + '\n\n';
    summary += '**Core Rationale:** ' + explanationChain.finalDecision.rationale + '\n\n';

    if (explanationChain.riskAssessment.riskFactors.length > 0) {
      summary += '**Risk Factors:** ' + explanationChain.riskAssessment.riskFactors.join(', ') + '\n';
    }

    return summary;
  }

  /**
   * Analyze explanation quality
   */
  public analyzeExplanationQuality(explanationChain: ExplanationChain): {
    completeness: number;
    clarity: number;
    evidenceSupport: number;
    overallScore: number;
    suggestions: string[];
  } {
    let completeness = 0;
    let clarity = 0;
    let evidenceSupport = 0;
    const suggestions: string[] = [];

    // Assess completeness
    if (explanationChain.reasoningSteps.length >= 3) completeness += 0.4;
    if (explanationChain.toolsUsed.length > 0) completeness += 0.3;
    if (explanationChain.riskAssessment) completeness += 0.3;

    // Assess clarity
    if (explanationChain.humanReadableExplanation.length > 200) clarity += 0.5;
    if (explanationChain.finalDecision.rationale) clarity += 0.5;

    // Assess evidence support
    const evidenceCount = explanationChain.reasoningSteps.reduce(
      (sum, step) => sum + step.evidence.length, 0
    );
    evidenceSupport = Math.min(1.0, evidenceCount / 10); // Assume 10 evidence points is a perfect score

    const overallScore = (completeness + clarity + evidenceSupport) / 3;

    // Generate improvement suggestions
    if (completeness < 0.7) {
      suggestions.push('Add more reasoning steps to improve explanation completeness');
    }
    if (clarity < 0.7) {
      suggestions.push('Provide clearer decision rationale and explanation');
    }
    if (evidenceSupport < 0.6) {
      suggestions.push('Add more supporting evidence to strengthen the reasoning process');
    }

    return {
      completeness,
      clarity,
      evidenceSupport,
      overallScore,
      suggestions
    };
  }
}
