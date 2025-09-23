// Agent related types
export interface AgentStatus {
  status: 'active' | 'inactive' | 'learning' | 'deciding';
  autonomyLevel: number;
  confidence: number;
  lastAction: string;
  uptime: number;
}

export interface AgentMetrics {
  todayDecisions: number;
  timeSaved: number; // in hours
  conflictsResolved: number;
  satisfactionScore: number;
  meetingsOptimized: number;
}

export interface AgentDecision {
  id: string;
  timestamp: Date;
  type: 'meeting_cancel' | 'meeting_merge' | 'meeting_optimize' | 'conflict_resolve' | 'task_escalate';
  context: any;
  reasoning: {
    factors: string[];
    alternatives: string[];
    selected: string;
    confidence: number;
    explanation: string;
  };
  outcome?: {
    expected: any;
    actual?: any;
    reward?: number;
  };
  status: 'pending' | 'approved' | 'executed' | 'rejected';
}

export interface Meeting {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  participants: string[];
  type: 'recurring' | 'one-time' | 'urgent';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  efficiencyScore?: number;
  decisionRate?: number;
  agenda?: AgendaItem[];
  decisions?: Decision[];
  tasks?: Task[];
}

export interface AgendaItem {
  id: string;
  title: string;
  type: 'discussion' | 'decision' | 'info' | 'action';
  duration: number;
  priority: 'high' | 'medium' | 'low';
  owner?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  maker: string;
  timestamp: Date;
  impact: 'high' | 'medium' | 'low';
  status: 'proposed' | 'approved' | 'rejected' | 'implemented';
}

export interface Task {
  id: string;
  title: string;
  description: string;
  owner: string;
  dueDate: Date;
  priority: 'high' | 'medium' | 'low';
  status: 'assigned' | 'in_progress' | 'completed' | 'blocked';
  blockedBy?: string;
  dependencies?: string[];
}

export interface AgentActivity {
  id: string;
  timestamp: Date;
  type: 'decision' | 'action' | 'learning' | 'optimization';
  title: string;
  description: string;
  impact: string;
  confidence?: number;
}

export interface ConflictResolution {
  id: string;
  type: 'schedule_conflict' | 'resource_conflict' | 'priority_conflict';
  severity: 'low' | 'medium' | 'high';
  affectedMeetings: string[];
  resolution: string;
  autoResolved: boolean;
  timestamp: Date;
}

export interface LearningPattern {
  id: string;
  pattern: string;
  confidence: number;
  timesObserved: number;
  successRate: number;
  lastObserved: Date;
  actionTaken?: string;
}