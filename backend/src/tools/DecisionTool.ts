import { BaseTool, ToolDefinition, ToolExecutionResult, ToolParameter } from './ToolInterface.js';
import { Logger } from '../utils/Logger.js';

export class DecisionTool extends BaseTool {
  private logger: Logger;

  constructor() {
    super(
      'decision_engine',
      'Comprehensive decision-making and reasoning tool for meeting optimization',
      'decision'
    );
    this.logger = new Logger('DecisionTool');
  }

  public getDefinition(): ToolDefinition {
    const parameters: ToolParameter[] = [
      {
        name: 'action',
        type: 'string',
        description: 'Decision action to perform',
        required: true,
        validation: {
          enum: [
            'analyze_conflicts',
            'suggest_optimization',
            'evaluate_meeting_necessity',
            'recommend_scheduling',
            'assess_participant_availability',
            'calculate_roi',
            'generate_alternatives',
            'make_decision'
          ]
        }
      },
      { name: 'context', type: 'object', description: 'Context data', required: false },
      { name: 'meetings', type: 'array', description: 'Meetings array', required: false },
      { name: 'participants', type: 'array', description: 'Participants array', required: false },
      { name: 'timeRange', type: 'object', description: 'Time range {start,end}', required: false },
      { name: 'criteria', type: 'object', description: 'Decision criteria/weights', required: false },
      { name: 'goal', type: 'string', description: 'Optimization goal', required: false },
      { name: 'constraints', type: 'array', description: 'Constraints list', required: false },
      { name: 'options', type: 'array', description: 'Options for decision', required: false }
    ];

    return {
      name: this.name,
      description: this.description,
      category: this.category as any,
      parameters
    };
  }

  public async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  public async execute(parameters: Record<string, any>): Promise<ToolExecutionResult> {
    const start = Date.now();
    const validation = this.validateParameters(parameters);
    if (!validation.valid) {
      return this.createResult(false, null, `Parameter validation failed: ${validation.errors.join(', ')}`);
    }

    const action = String(parameters.action);
    try {
      let data: any = null;
      switch (action) {
        case 'analyze_conflicts':
          data = await this.handleAnalyzeConflicts(parameters);
          break;
        case 'suggest_optimization':
          data = await this.handleSuggestOptimization(parameters);
          break;
        case 'evaluate_meeting_necessity':
          data = await this.handleEvaluateMeetingNecessity(parameters);
          break;
        case 'recommend_scheduling':
          data = await this.handleRecommendScheduling(parameters);
          break;
        case 'assess_participant_availability':
          data = await this.handleAssessParticipantAvailability(parameters);
          break;
        case 'calculate_roi':
          data = await this.handleCalculateROI(parameters);
          break;
        case 'generate_alternatives':
          data = await this.handleGenerateAlternatives(parameters);
          break;
        case 'make_decision':
          data = await this.handleMakeDecision(parameters);
          break;
        default:
          return this.createResult(false, null, `Unknown action: ${action}`);
      }
      return this.createResult(true, data, undefined, { executionTime: Date.now() - start, source: this.name });
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.logger.error(`DecisionTool execution failed for action ${action}`, e);
      return this.createResult(false, null, msg, { executionTime: Date.now() - start, source: this.name });
    }
  }

  private async handleAnalyzeConflicts(params: Record<string, any>): Promise<any> {
    const meetings: any[] = Array.isArray(params.meetings) ? params.meetings : [];
    const parseTime = (v: any) => (typeof v === 'string' ? Date.parse(v) : NaN);
    const conflicts: any[] = [];
    for (let i = 0; i < meetings.length; i++) {
      for (let j = i + 1; j < meetings.length; j++) {
        const a = meetings[i];
        const b = meetings[j];
        const aStart = parseTime(a.startTime || a.start || a.timeStart);
        const aEnd = parseTime(a.endTime || a.end || a.timeEnd);
        const bStart = parseTime(b.startTime || b.start || b.timeStart);
        const bEnd = parseTime(b.endTime || b.end || b.timeEnd);
        if (isFinite(aStart) && isFinite(aEnd) && isFinite(bStart) && isFinite(bEnd)) {
          const overlap = aStart < bEnd && aEnd > bStart;
          if (overlap) {
            conflicts.push({ a: a.id || i, b: b.id || j, overlap: true });
          }
        }
      }
    }
    return { conflicts, conflictCount: conflicts.length };
  }

  private async handleSuggestOptimization(params: Record<string, any>): Promise<any> {
    const ctx = params.context || {};
    const goal = params.goal || 'general_optimization';
    const suggestions: any[] = [];
    const impact = { timeSaved: 0, efficiencyGain: 0, satisfactionImprovement: 0 };

    if (ctx.averageDuration && ctx.averageDuration > 60) {
      suggestions.push({
        type: 'duration_optimization',
        suggestion: 'Keep meetings within 45?60 minutes (会議は45?60分を目安に)',
        rationale: 'Long sessions reduce attention and efficiency',
        confidence: 0.85
      });
      impact.timeSaved += (ctx.averageDuration - 50) * (ctx.currentMeetings || 1);
    }
    if (typeof ctx.participantSatisfaction === 'number' && ctx.participantSatisfaction < 4.0) {
      suggestions.push({
        type: 'engagement_improvement',
        suggestion: 'Improve agenda and engagement (アジェンダと参加度の改善)',
        actions: ['Clarify objectives', 'Share materials in advance', 'Limit monologues', 'Ensure Q&A time'],
        confidence: 0.75
      });
      impact.satisfactionImprovement = 0.8;
    }
    if (ctx.currentMeetings && ctx.currentMeetings > 20) {
      suggestions.push({
        type: 'meeting_consolidation',
        suggestion: 'Consolidate or cancel redundant meetings (重複会議の統合/削減)',
        rationale: 'Too many meetings fragment time',
        confidence: 0.70
      });
      impact.timeSaved += (ctx.averageDuration || 30) * Math.floor(ctx.currentMeetings * 0.15);
    }

    if (goal === 'maximize_meeting_roi') {
      suggestions.push({
        type: 'roi_optimization',
        suggestion: 'Introduce ROI tracking and post-meeting reviews (ROIトラッキングの導入)',
        actions: ['Define success metrics', 'Post-meeting review', 'Periodic retrospectives'],
        confidence: 0.8
      });
    }
    return { suggestions, estimatedImpact: impact, goal };
  }

  private async handleEvaluateMeetingNecessity(params: Record<string, any>): Promise<any> {
    const meetings: any[] = Array.isArray(params.meetings) ? params.meetings : [];
    const evals = meetings.map((m) => {
      const necessity = Math.min(1, Math.max(0, (m.importance || 0.6) * (m.stakeholders ? 0.7 : 0.5)));
      const recommendation = necessity >= 0.6 ? 'keep' : necessity >= 0.4 ? 'optional' : 'cancel';
      return { meetingId: m.id, title: m.title, necessity, recommendation };
    });
    return { evaluations: evals, totalMeetings: meetings.length };
  }

  private async handleRecommendScheduling(params: Record<string, any>): Promise<any> {
    const meetings: any[] = Array.isArray(params.meetings) ? params.meetings : [];
    const participants: any[] = Array.isArray(params.participants) ? params.participants : [];
    const recs = meetings.map((m) => ({
      meetingId: m.id,
      currentTime: m.startTime || null,
      recommendedTimes: this.generateSimpleSlots(3),
      reasoning: ['Prefer business hours', 'Avoid conflicts']
    }));
    return { recommendations: recs, participantsCount: participants.length };
  }

  private async handleAssessParticipantAvailability(params: Record<string, any>): Promise<any> {
    const participants: any[] = Array.isArray(params.participants) ? params.participants : [];
    const timeRange = params.timeRange || {};
    const assessments = participants.map((p, idx) => ({
      participant: p,
      availability: 0.6 + (idx % 3) * 0.1
    }));
    return { assessments, timeRange };
  }

  private async handleCalculateROI(params: Record<string, any>): Promise<any> {
    const meetings: any[] = Array.isArray(params.meetings) ? params.meetings : [];
    const context = params.context || {};
    const results = meetings.map((m) => {
      const value = (m.impact || 1) * (context.valueFactor || 1);
      const cost = (m.duration || 30) * (m.participants?.length || 3);
      const roi = value / Math.max(1, cost);
      return { meetingId: m.id, roi, value, cost };
    });
    return { roiCalculations: results };
  }

  private async handleGenerateAlternatives(params: Record<string, any>): Promise<any> {
    const context = params.context || {};
    const goal = params.goal || 'general';
    const constraints: any[] = Array.isArray(params.constraints) ? params.constraints : [];
    const alternatives = [
      { id: 'opt_1', action: 'shorten_meeting', score: 0.7 },
      { id: 'opt_2', action: 'async_update', score: 0.8 },
      { id: 'opt_3', action: 'merge_meetings', score: 0.65 }
    ];
    return { alternatives, goal, constraints, context };
  }

  private async handleMakeDecision(params: Record<string, any>): Promise<any> {
    const options: any[] = Array.isArray(params.options) ? params.options : [];
    if (!options.length) return { decided: false, reason: 'no_options' };
    const criteria = params.criteria || {};
    const scored = options.map((opt) => ({
      option: opt,
      score: this.calculateOptionScore(opt, criteria, params.context)
    }));
    scored.sort((a, b) => b.score - a.score);
    return { decided: true, selected: scored[0].option, score: scored[0].score };
  }

  private generateSimpleSlots(n: number): Array<{ start: string; end: string }> {
    const slots: any[] = [];
    const now = Date.now();
    for (let i = 1; i <= n; i++) {
      const s = new Date(now + i * 24 * 60 * 60 * 1000);
      s.setHours(9, 0, 0, 0);
      const e = new Date(s.getTime() + 60 * 60 * 1000);
      slots.push({ start: s.toISOString(), end: e.toISOString() });
    }
    return slots;
  }

  private calculateOptionScore(opt: any, criteria?: any, context?: any): number {
    const base = 0.6;
    const weightImpact = criteria?.impactWeight ?? 0.3;
    const weightCost = criteria?.costWeight ?? 0.2;
    const impact = opt.impact ?? 0.7;
    const cost = opt.cost ?? 0.5;
    return Math.max(0, Math.min(1, base + weightImpact * impact - weightCost * cost));
  }

  protected createResult(success: boolean, data?: any, error?: string, metadata?: any): ToolExecutionResult {
    return { success, data, error, metadata: { executionTime: metadata?.executionTime || 0, ...metadata } };
  }
}