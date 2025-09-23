import { VertexAIService } from '../../services/VertexAIService.js';
import { MemorySystem } from './MemorySystem.js';
import { Logger } from '../../utils/Logger.js';

export class ReasoningEngine {
  private vertexAI: VertexAIService;
  private memory: MemorySystem;
  private logger: Logger;

  constructor(memory: MemorySystem) {
    this.memory = memory;
    this.vertexAI = new VertexAIService();
    this.logger = new Logger('ReasoningEngine');
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    try {
      this.logger.debug('Starting reasoning process', { inputType: input.context?.type });

      // Step 1: Prepare reasoning context
      const enhancedContext = await this.prepareContext(input);

      // Step 2: Call Vertex AI for reasoning
      const reasoningResult = await this.performReasoning(enhancedContext);

      // Step 3: Post-processing and validation
      const validatedResult = await this.validateAndEnhance(reasoningResult, input);

      // Step 4: Record the reasoning process
      await this.recordReasoningProcess(input, validatedResult);

      this.logger.info('Reasoning complete', { 
        confidence: validatedResult.confidence,
        decision: validatedResult.decision.action 
      });

      return validatedResult;
    } catch (error) {
      this.logger.error('Reasoning process failed', error);
      return this.createFallbackResponse(input, error as Error);
    }
  }

  private async prepareContext(input: ReasoningInput): Promise<EnhancedContext> {
    // Get relevant historical experiences
    const relevantMemories = await this.memory.getRelevantMemories(input.context, 10);
    
    // Get relevant patterns and rules
    const applicablePatterns = await this.memory.getApplicablePatterns(input.context);
    
    // Get current system state
    const systemState = await this.getSystemState();

    return {
      ...input,
      historicalContext: relevantMemories,
      patterns: applicablePatterns,
      systemState: systemState,
      timestamp: new Date(),
    };
  }

  private async performReasoning(context: EnhancedContext): Promise<any> {
    const prompt = this.constructReasoningPrompt(context);
    return await this.vertexAI.generateReasoningResponse(prompt, context);
  }

  private constructReasoningPrompt(context: EnhancedContext): string {
    const { problem, opportunity, goal, historicalContext, patterns } = context;

    let prompt = `As SmartMeet AI Agent, please perform reasoning and decision-making in Japanese based on the following information.\n\n`;

    // Goal setting
    if (goal) {
      prompt += `Goal: ${goal}\n\n`;
    }

    // Problem or opportunity description
    if (problem) {
      prompt += `Problem to solve:\n${JSON.stringify(problem, null, 2)}\n\n`;
    }
    
    if (opportunity) {
      prompt += `Opportunity seized:\n${JSON.stringify(opportunity, null, 2)}\n\n`;
    }

    // Historical experience
    if (historicalContext && historicalContext.length > 0) {
      prompt += `Relevant past experiences:\n`;
      historicalContext.forEach((memory, index) => {
        prompt += `${index + 1}. ${memory.event} (Outcome: ${memory.outcome}, Reward: ${memory.reward})\n`;
      });
      prompt += '\n';
    }

    // Identified patterns
    if (patterns && patterns.length > 0) {
      prompt += `Identified relevant patterns:\n`;
      patterns.forEach((pattern, index) => {
        prompt += `${index + 1}. ${pattern.name}: ${pattern.description} (confidence: ${pattern.confidence})\n`;
      });
      prompt += '\n';
    }

    // Current constraints and context
    prompt += `Current context:\n${JSON.stringify(context.context, null, 2)}\n\n`;

    prompt += `Please reason step-by-step and consider the following:
1. Root cause analysis of the problem
2. Possible courses of action and their respective pros and cons
3. Applicability of past experiences
4. Expected outcomes and risk assessment
5. Resource requirements and time constraints

Please present a structured decision proposal.`;

    return prompt;
  }

  private async validateAndEnhance(result: any, originalInput: ReasoningInput): Promise<ReasoningOutput> {
    // Validate the integrity of the reasoning result
    if (!result.decision || !result.confidence) {
      throw new Error('Incomplete reasoning result');
    }

    // Calibrate confidence
    const calibratedConfidence = await this.calibrateConfidence(result.confidence, originalInput);

    // Add risk assessment
    const riskAssessment = await this.assessRisks(result, originalInput);

    // Generate execution plan
    const executionPlan = await this.generateExecutionPlan(result.decision);

    return {
      reasoning: result.reasoning,
      decision: result.decision,
      confidence: calibratedConfidence,
      alternatives: result.alternatives || [],
      risks: riskAssessment,
      explanation: result.explanation,
      executionPlan: executionPlan,
      metadata: {
        timestamp: new Date(),
        reasoningTime: Date.now(),
        inputHash: this.hashInput(originalInput)
      }
    };
  }

  private async calibrateConfidence(rawConfidence: number, input: ReasoningInput): Promise<number> {
    // Adjust confidence based on historical accuracy
    const historicalAccuracy = await this.memory.getHistoricalAccuracy(input.context?.type);
    
    // Adjust based on problem complexity
    const complexityFactor = this.assessComplexity(input);
    
    // Adjust based on the quality of available information
    const informationQuality = this.assessInformationQuality(input);

    let calibratedConfidence = rawConfidence;
    
    // Apply historical accuracy
    if (historicalAccuracy < 0.8) {
      calibratedConfidence *= 0.9;
    }
    
    // Apply complexity adjustment
    calibratedConfidence *= (1 - complexityFactor * 0.2);
    
    // Apply information quality adjustment
    calibratedConfidence *= informationQuality;

    return Math.max(0.1, Math.min(0.99, calibratedConfidence));
  }

  private async assessRisks(result: any, input: ReasoningInput): Promise<Risk[]> {
    const risks: Risk[] = [];

    // Risks extracted from the result
    if (result.risks) {
      risks.push(...result.risks.map((r: any) => ({
        type: 'identified',
        description: r.risk,
        probability: r.probability,
        impact: this.classifyImpact(r.risk),
        mitigation: r.mitigation
      })));
    }

    // Risk assessment based on historical data
    const historicalRisks = await this.memory.getHistoricalRisks(result.decision.action);
    risks.push(...historicalRisks);

    // Systematic risk assessment
    if (result.confidence < 0.5) {
      risks.push({
        type: 'confidence',
        description: 'Low decision confidence',
        probability: 'medium',
        impact: 'medium',
        mitigation: 'Recommend manual review or gathering more information'
      });
    }

    return risks;
  }

  private async generateExecutionPlan(decision: any): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];

    // Parse action steps from the decision
    if (decision.action) {
      steps.push({
        id: `step_${Date.now()}_1`,
        description: decision.action,
        type: 'primary_action',
        estimatedDuration: 5, // default 5 minutes
        dependencies: [],
        validation: `Verify the execution result of "${decision.action}"`
      });
    }

    // Add validation step
    steps.push({
      id: `step_${Date.now()}_2`,
      description: 'Verify execution results and collect feedback',
      type: 'validation',
      estimatedDuration: 2,
      dependencies: [steps[0]?.id || ''],
      validation: 'Confirm that the action has achieved the expected result'
    });

    return steps;
  }

  private async recordReasoningProcess(input: ReasoningInput, output: ReasoningOutput): Promise<void> {
    const reasoningRecord = {
      id: `reasoning_${Date.now()}`,
      timestamp: new Date(),
      input: this.sanitizeInput(input),
      output: this.sanitizeOutput(output),
      performance: {
        confidence: output.confidence,
        executionTime: Date.now() - (output.metadata?.reasoningTime || Date.now())
      }
    };

    await this.memory.storeReasoningRecord(reasoningRecord);
  }

  private createFallbackResponse(input: ReasoningInput, error: Error): ReasoningOutput {
    return {
      reasoning: {
        situation_analysis: 'Error in reasoning engine, using fallback logic',
        key_factors: ['System error'],
        options: [{
          action: 'Request manual intervention',
          pros: ['Avoid incorrect automated decisions'],
          cons: ['Response delay'],
          impact: 'Temporarily suspend automated processing'
        }]
      },
      decision: {
        action: 'Escalate to manual handling',
        rationale: `Reasoning engine failure: ${error.message}`,
        expected_outcome: 'Manual review and handling'
      },
      confidence: 0.1,
      alternatives: [],
      risks: [{
        type: 'system',
        description: 'Reasoning system failure',
        probability: 'high',
        impact: 'high',
        mitigation: 'Notify technical team immediately'
      }],
      explanation: 'Due to a technical failure, the decision has been escalated for manual handling',
      executionPlan: [{
        id: 'fallback_1',
        description: 'Notify relevant parties and request manual intervention',
        type: 'escalation',
        estimatedDuration: 0,
        dependencies: [],
        validation: 'Confirm manual intervention'
      }],
      metadata: {
        timestamp: new Date(),
        reasoningTime: Date.now(),
        inputHash: this.hashInput(input),
        error: true
      }
    };
  }

  private async getSystemState(): Promise<any> {
    return {
      timestamp: new Date(),
      load: 'normal', // Can be obtained from a monitoring system
      availableResources: 'adequate',
      recentErrors: 0
    };
  }

  private assessComplexity(input: ReasoningInput): number {
    let complexity = 0.0;
    
    if (input.context?.affectedEntities?.length > 5) complexity += 0.2;
    if (input.context?.urgency === 'high') complexity += 0.1;
    if (input.context?.impact === 'high') complexity += 0.2;
    if (input.context?.constraints?.length > 3) complexity += 0.1;

    return Math.min(1.0, complexity);
  }

  private assessInformationQuality(input: ReasoningInput): number {
    let quality = 1.0;
    
    if (!input.context) quality -= 0.3;
    if (!input.goal) quality -= 0.1;
    if (!input.problem && !input.opportunity) quality -= 0.2;

    return Math.max(0.3, quality);
  }

  private classifyImpact(riskDescription: string): 'low' | 'medium' | 'high' {
    const highImpactKeywords = ['cancel', 'delay', 'conflict', 'fail'];
    const mediumImpactKeywords = ['adjust', 'modify', 'notify'];
    
    if (highImpactKeywords.some(keyword => riskDescription.includes(keyword))) {
      return 'high';
    } else if (mediumImpactKeywords.some(keyword => riskDescription.includes(keyword))) {
      return 'medium';
    }
    return 'low';
  }

  private hashInput(input: ReasoningInput): string {
    return Buffer.from(JSON.stringify(input)).toString('base64').slice(0, 16);
  }

  private sanitizeInput(input: ReasoningInput): any {
    return {
      context: input.context,
      goal: input.goal,
      hasProblem: !!input.problem,
      hasOpportunity: !!input.opportunity
    };
  }

  private sanitizeOutput(output: ReasoningOutput): any {
    return {
      decision: output.decision.action,
      confidence: output.confidence,
      risksCount: output.risks.length,
      hasExecutionPlan: !!output.executionPlan
    };
  }
}

// Type definitions
interface ReasoningInput {
  context: any;
  problem?: any;
  opportunity?: any;
  goal: string;
}

interface EnhancedContext extends ReasoningInput {
  historicalContext: any[];
  patterns: any[];
  systemState: any;
  timestamp: Date;
}

interface ReasoningOutput {
  reasoning: any;
  decision: any;
  confidence: number;
  alternatives: any[];
  risks: Risk[];
  explanation: string;
  executionPlan: ExecutionStep[];
  metadata: {
    timestamp: Date;
    reasoningTime: number;
    inputHash: string;
    error?: boolean;
  };
}

interface Risk {
  type: string;
  description: string;
  probability: string;
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
}

interface ExecutionStep {
  id: string;
  description: string;
  type: 'primary_action' | 'validation' | 'escalation';
  estimatedDuration: number;
  dependencies: string[];
  validation: string;
}