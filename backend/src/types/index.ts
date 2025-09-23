// Agent相关类型定义
export interface AgentConfig {
  autonomyLevel: number; // 0-1
  proactiveThreshold: number;
  autonomousThreshold: number;
  escalationThreshold: number;
  learningRate: number;
  maxDecisionsPerHour: number;
}

export interface AgentMemory {
  episodic: EpisodicMemory[];
  semantic: SemanticMemory[];
  procedural: ProceduralMemory[];
}

export interface EpisodicMemory {
  id: string;
  timestamp: Date;
  event: string;
  context: any;
  outcome: any;
  reward: number;
  embedding: number[];
}

export interface SemanticMemory {
  id: string;
  domain: string;
  facts: Fact[];
  rules: Rule[];
  patterns: Pattern[];
}

export interface ProceduralMemory {
  id: string;
  skill: string;
  steps: string[];
  successRate: number;
  lastUsed: Date;
}

export interface Fact {
  statement: string;
  confidence: number;
  evidence: string[];
  lastUpdated: Date;
}

export interface Rule {
  condition: string;
  action: string;
  successRate: number;
  timesApplied: number;
}

export interface Pattern {
  name: string;
  description: string;
  features: string[];
  confidence: number;
  occurrences: number;
}

export interface AgentDecision {
  id: string;
  timestamp: Date;
  type: DecisionType;
  context: DecisionContext;
  reasoning: ReasoningProcess;
  confidence: number;
  status: 'pending' | 'approved' | 'executed' | 'rejected';
  outcome?: DecisionOutcome;
}

export type DecisionType = 
  | 'meeting_cancel'
  | 'meeting_merge' 
  | 'meeting_optimize'
  | 'conflict_resolve'
  | 'task_escalate'
  | 'schedule_adjust';

export interface DecisionContext {
  trigger: string;
  affectedEntities: string[];
  urgency: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  constraints: string[];
}

export interface ReasoningProcess {
  factors: Factor[];
  alternatives: Alternative[];
  selected: Alternative;
  explanation: string;
  confidence: number;
}

export interface Factor {
  name: string;
  weight: number;
  value: number;
  description: string;
}

export interface Alternative {
  action: string;
  pros: string[];
  cons: string[];
  expectedOutcome: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface DecisionOutcome {
  expected: any;
  actual?: any;
  success: boolean;
  reward: number;
  feedback?: string;
}

export interface Meeting {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  participants: Participant[];
  organizer: string;
  type: 'recurring' | 'one-time' | 'urgent';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  calendarEventId?: string;
  meetingLink?: string;
  agenda?: AgendaItem[];
  decisions?: Decision[];
  tasks?: Task[];
  analytics?: MeetingAnalytics;
}

export interface Participant {
  email: string;
  name: string;
  role?: string;
  mandatory: boolean;
  responseStatus: 'needsAction' | 'accepted' | 'declined' | 'tentative';
}

export interface AgendaItem {
  id: string;
  title: string;
  description?: string;
  type: 'discussion' | 'decision' | 'info' | 'action';
  duration: number; // minutes
  priority: 'high' | 'medium' | 'low';
  owner?: string;
  status: 'pending' | 'in_progress' | 'completed';
  dependencies?: string[];
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  type: 'strategic' | 'tactical' | 'operational';
  maker: string;
  timestamp: Date;
  deadline?: Date;
  impact: 'high' | 'medium' | 'low';
  status: 'proposed' | 'approved' | 'rejected' | 'implemented';
  stakeholders: string[];
  rationale?: string;
  sessionId?: string; // 添加sessionId支持
  goal?: string; // 添加goal支持
  confidence?: number; // 添加confidence支持
  reasoning?: string; // 添加reasoning支持
  toolsUsed?: any[]; // 添加toolsUsed支持
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: 'action_item' | 'follow_up' | 'research';
  owner: string;
  assignedBy: string;
  createdAt: Date;
  dueDate: Date;
  priority: 'high' | 'medium' | 'low';
  status: 'assigned' | 'in_progress' | 'completed' | 'blocked';
  blockedBy?: string;
  blockingReason?: string;
  dependencies?: string[];
  estimatedHours?: number;
  progress?: number; // 0-100
}

export interface MeetingAnalytics {
  efficiencyScore: number; // 0-1
  decisionRate: number; // decisions per hour
  engagementLevel: number; // 0-1
  timeUtilization: number; // actual vs planned
  outcomeQuality: number; // 0-1
  participantSatisfaction: number; // 0-5
  followUpRate: number; // 0-1
}

export interface ConflictResolution {
  id: string;
  type: 'schedule' | 'resource' | 'priority' | 'participant';
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedMeetings: string[];
  affectedParticipants: string[];
  detectedAt: Date;
  resolvedAt?: Date;
  resolution?: string;
  autoResolved: boolean;
  satisfaction?: number;
}

export interface LearningPattern {
  id: string;
  name: string;
  category: 'meeting_efficiency' | 'decision_quality' | 'team_dynamics' | 'scheduling';
  pattern: string;
  confidence: number;
  evidence: Evidence[];
  actionTaken?: string;
  impact: Impact;
  lastObserved: Date;
}

export interface Evidence {
  type: 'meeting_data' | 'user_feedback' | 'outcome_metrics';
  data: any;
  timestamp: Date;
  reliability: number;
}

export interface Impact {
  metric: string;
  before: number;
  after: number;
  improvement: number;
  duration: string;
}

// Types for the Planning Module
export interface Plan {
  strategic: StrategicPlan;
  tactical: TacticalPlan;
  operational: OperationalPlan;
}

export interface StrategicPlan {
  quarterly: {
    target: string;
    metrics: string[];
    milestones: { week: number; action: string }[];
  };
}

export interface TacticalPlan {
  thisWeek: {
    meetings_to_optimize: string[];
    tasks_to_follow: string[];
    conflicts_to_resolve: any[]; // Replace 'any' with a specific conflict type if available
  };
}

export interface OperationalPlan {
  nextActions: {
    action: string;
    params: any;
    priority: number;
  }[];
}

// General Agent Types
export interface AgentContext {
  timestamp: Date;
  // For now, we'll keep this simple to match the mock perception output.
  // In a real implementation, this would be fully fleshed out.
  [key: string]: any; 
}


export interface AgentAction {
  action: string;
  params: any;
  confidence: number;
  explanation: string;
}