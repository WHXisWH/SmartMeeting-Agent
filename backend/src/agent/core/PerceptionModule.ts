import { GoogleWorkspaceService } from '../../services/GoogleWorkspaceService.js';
import { VertexAIService } from '../../services/VertexAIService.js';
import { Logger } from '../../utils/Logger.js';

export class PerceptionModule {
  private googleWorkspace: GoogleWorkspaceService;
  private vertexAI: VertexAIService;
  private logger: Logger;
  private sensors: Map<string, Sensor>;

  constructor() {
    this.googleWorkspace = new GoogleWorkspaceService();
    this.vertexAI = new VertexAIService();
    this.logger = new Logger('PerceptionModule');
    this.sensors = new Map();
    
    this.initializeSensors();
  }

  private initializeSensors(): void {
    this.sensors.set('calendar', new CalendarSensor(this.googleWorkspace));
    this.sensors.set('email', new EmailSensor(this.googleWorkspace, this.vertexAI));
    this.sensors.set('document', new DocumentSensor(this.googleWorkspace));
    this.sensors.set('activity', new ActivitySensor());
  }

  async perceive(): Promise<PerceptionResult> {
    try {
      this.logger.debug('Starting environmental perception...');
      
      // Collect data from all sensors in parallel
      const sensorPromises = Array.from(this.sensors.entries()).map(async ([name, sensor]) => {
        try {
          const data = await sensor.collect();
          return { name, data, error: null };
        } catch (error) {
          this.logger.warn(`Sensor ${name} failed to collect data`, error);
          return { name, data: null, error: error as Error };
        }
      });

      const sensorResults = await Promise.all(sensorPromises);
      
      // Signal fusion and processing
      const processedSignals = await this.processSignals(sensorResults);
      
      // Anomaly detection
      const anomalies = await this.detectAnomalies(processedSignals);
      
      // Opportunity identification
      const opportunities = await this.identifyOpportunities(processedSignals);
      
      // Risk assessment
      const risks = await this.assessRisks(processedSignals, anomalies);

      const result: PerceptionResult = {
        timestamp: new Date(),
        signals: processedSignals,
        anomalies,
        opportunities,
        risks,
        metadata: {
          sensorsActive: sensorResults.filter(r => r.error === null).length,
          sensorsTotal: this.sensors.size,
          processingTime: Date.now()
        }
      };

      this.logger.info('Perception complete', {
        signalsCount: processedSignals.length,
        anomaliesCount: anomalies.length,
        opportunitiesCount: opportunities.length,
        risksCount: risks.length
      });

      return result;
    } catch (error) {
      this.logger.error('Perception process failed', error);
      throw error;
    }
  }

  private async processSignals(sensorResults: SensorResult[]): Promise<Signal[]> {
    const signals: Signal[] = [];

    for (const result of sensorResults) {
      if (result.error || !result.data) continue;

      switch (result.name) {
        case 'calendar':
          signals.push(...this.processCalendarSignals(result.data));
          break;
        case 'email':
          signals.push(...this.processEmailSignals(result.data));
          break;
        case 'document':
          signals.push(...this.processDocumentSignals(result.data));
          break;
        case 'activity':
          signals.push(...this.processActivitySignals(result.data));
          break;
      }
    }

    // Sort signals by priority
    return signals.sort((a, b) => this.getSignalPriority(b) - this.getSignalPriority(a));
  }

  private processCalendarSignals(calendarData: any): Signal[] {
    const signals: Signal[] = [];

    // Detect meeting conflicts
    if (calendarData.conflicts && calendarData.conflicts.length > 0) {
      signals.push({
        id: `conflict_${Date.now()}`,
        type: 'calendar_conflict',
        urgency: 'high',
        description: `Detected ${calendarData.conflicts.length} meeting conflicts`,
        data: calendarData.conflicts,
        confidence: 0.9,
        timestamp: new Date()
      });
    }

    // Detect meeting overload
    if (calendarData.meetingDensity > 0.8) {
      signals.push({
        id: `overload_${Date.now()}`,
        type: 'meeting_overload',
        urgency: 'medium',
        description: 'High meeting density, may affect work efficiency',
        data: { density: calendarData.meetingDensity },
        confidence: 0.8,
        timestamp: new Date()
      });
    }

    // Detect duplicate meetings
    if (calendarData.duplicates && calendarData.duplicates.length > 0) {
      signals.push({
        id: `duplicate_${Date.now()}`,
        type: 'duplicate_meetings',
        urgency: 'low',
        description: `Found ${calendarData.duplicates.length} possible duplicate meetings`,
        data: calendarData.duplicates,
        confidence: 0.7,
        timestamp: new Date()
      });
    }

    return signals;
  }

  private processEmailSignals(emailData: any): Signal[] {
    const signals: Signal[] = [];

    // Detect urgent emails
    if (emailData.urgentEmails && emailData.urgentEmails.length > 0) {
      for (const email of emailData.urgentEmails) {
        signals.push({
          id: `urgent_email_${email.id}`,
          type: 'urgent_communication',
          urgency: 'high',
          description: `Received urgent email: ${email.subject}`,
          data: email,
          confidence: email.urgencyScore || 0.8,
          timestamp: new Date(email.timestamp)
        });
      }
    }

    // Meeting related emails
    if (emailData.meetingRelated && emailData.meetingRelated.length > 0) {
      for (const email of emailData.meetingRelated) {
        signals.push({
          id: `meeting_email_${email.id}`,
          type: 'meeting_communication',
          urgency: 'medium',
          description: `Received meeting-related email: ${email.subject}`,
          data: email,
          confidence: 0.7,
          timestamp: new Date(email.timestamp)
        });
      }
    }

    return signals;
  }

  private processDocumentSignals(documentData: any): Signal[] {
    const signals: Signal[] = [];

    // Detect document updates
    if (documentData.recentUpdates && documentData.recentUpdates.length > 0) {
      for (const doc of documentData.recentUpdates) {
        signals.push({
          id: `doc_update_${doc.id}`,
          type: 'document_update',
          urgency: 'low',
          description: `Document updated: ${doc.title}`,
          data: doc,
          confidence: 0.6,
          timestamp: new Date(doc.lastModified)
        });
      }
    }

    return signals;
  }

  private processActivitySignals(activityData: any): Signal[] {
    const signals: Signal[] = [];

    // Detect team activity anomalies
    if (activityData.unusualPatterns && activityData.unusualPatterns.length > 0) {
      for (const pattern of activityData.unusualPatterns) {
        signals.push({
          id: `activity_${pattern.id}`,
          type: 'activity_anomaly',
          urgency: 'medium',
          description: pattern.description,
          data: pattern,
          confidence: pattern.confidence || 0.7,
          timestamp: new Date()
        });
      }
    }

    return signals;
  }

  private getSignalPriority(signal: Signal): number {
    const urgencyWeight = {
      'high': 100,
      'medium': 50,
      'low': 10
    };

    return (urgencyWeight[signal.urgency] || 0) * signal.confidence;
  }

  private async detectAnomalies(signals: Signal[]): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Detect meeting pattern anomalies
    const calendarSignals = signals.filter(s => s.type.startsWith('calendar'));
    if (calendarSignals.length > 5) {
      anomalies.push({
        id: `anomaly_${Date.now()}`,
        type: 'calendar_pattern_anomaly',
        severity: 'high',
        description: 'Detected abnormal schedule pattern',
        affectedSignals: calendarSignals.map(s => s.id),
        confidence: 0.8,
        timestamp: new Date()
      });
    }

    // Detect communication anomalies
    const urgentSignals = signals.filter(s => s.urgency === 'high');
    if (urgentSignals.length > 3) {
      anomalies.push({
        id: `anomaly_urgent_${Date.now()}`,
        type: 'communication_spike',
        severity: 'medium',
        description: 'Detected abnormal increase in urgent communications',
        affectedSignals: urgentSignals.map(s => s.id),
        confidence: 0.7,
        timestamp: new Date()
      });
    }

    return anomalies;
  }

  private async identifyOpportunities(signals: Signal[]): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    // Identify optimization opportunities
    const duplicateSignals = signals.filter(s => s.type === 'duplicate_meetings');
    if (duplicateSignals.length > 0) {
      opportunities.push({
        id: `opp_merge_${Date.now()}`,
        type: 'meeting_optimization',
        description: 'Can merge duplicate meetings to improve efficiency',
        potentialImpact: 'medium',
        estimatedSavings: duplicateSignals.length * 30, // minutes
        confidence: 0.8,
        timestamp: new Date(),
        relatedSignals: duplicateSignals.map(s => s.id)
      });
    }

    // Identify scheduling opportunities
    const overloadSignals = signals.filter(s => s.type === 'meeting_overload');
    if (overloadSignals.length > 0) {
      opportunities.push({
        id: `opp_reschedule_${Date.now()}`,
        type: 'schedule_optimization',
        description: 'Can reschedule meetings to balance workload',
        potentialImpact: 'high',
        estimatedSavings: 60, // minutes
        confidence: 0.7,
        timestamp: new Date(),
        relatedSignals: overloadSignals.map(s => s.id)
      });
    }

    return opportunities;
  }

  private async assessRisks(signals: Signal[], anomalies: Anomaly[]): Promise<Risk[]> {
    const risks: Risk[] = [];

    // Risks based on conflict signals
    const conflictSignals = signals.filter(s => s.type === 'calendar_conflict');
    if (conflictSignals.length > 0) {
      risks.push({
        id: `risk_conflict_${Date.now()}`,
        type: 'schedule_disruption',
        severity: 'high',
        description: 'Schedule conflicts may lead to meeting failures or delays',
        probability: 0.8,
        potentialImpact: 'high',
        mitigationSuggestions: ['Reschedule conflicting meetings immediately', 'Notify relevant participants'],
        timestamp: new Date()
      });
    }

    // Risks based on anomaly patterns
    const highSeverityAnomalies = anomalies.filter(a => a.severity === 'high');
    if (highSeverityAnomalies.length > 0) {
      risks.push({
        id: `risk_anomaly_${Date.now()}`,
        type: 'system_instability',
        severity: 'medium',
        description: 'Detected abnormal patterns may affect team collaboration',
        probability: 0.6,
        potentialImpact: 'medium',
        mitigationSuggestions: ['Monitor anomaly development', 'Prepare backup plans'],
        timestamp: new Date()
      });
    }

    return risks;
  }
}

// Base class and implementations for sensors
abstract class Sensor {
  abstract collect(): Promise<any>;
}

class CalendarSensor extends Sensor {
  constructor(private googleWorkspace: GoogleWorkspaceService) {
    super();
  }

  async collect(): Promise<any> {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const events = await this.googleWorkspace.getEvents(now, tomorrow);
    
    return {
      events,
      conflicts: await this.detectConflicts(events),
      meetingDensity: this.calculateDensity(events),
      duplicates: this.findDuplicates(events)
    };
  }

  private async detectConflicts(events: any[]): Promise<any[]> {
    // Simplified conflict detection logic
    const conflicts: any[] = [];
    
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        if (this.eventsOverlap(events[i], events[j])) {
          conflicts.push({
            event1: events[i],
            event2: events[j],
            overlapTime: this.calculateOverlap(events[i], events[j])
          });
        }
      }
    }
    
    return conflicts;
  }

  private calculateDensity(events: any[]): number {
    if (events.length === 0) return 0;
    
    const totalTime = 24 * 60; // 24 hours = 1440 minutes
    let meetingTime = 0;
    
    for (const event of events) {
      if (event.start?.dateTime && event.end?.dateTime) {
        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);
        meetingTime += (end.getTime() - start.getTime()) / (1000 * 60);
      }
    }
    
    return Math.min(1.0, meetingTime / totalTime);
  }

  private findDuplicates(events: any[]): any[] {
    // Simplified duplicate detection logic
    return events.filter((event, index) => 
      events.findIndex(e => 
        e.summary === event.summary && 
        e.start?.dateTime === event.start?.dateTime
      ) !== index
    );
  }

  private eventsOverlap(event1: any, event2: any): boolean {
    if (!event1.start?.dateTime || !event1.end?.dateTime || 
        !event2.start?.dateTime || !event2.end?.dateTime) {
      return false;
    }

    const start1 = new Date(event1.start.dateTime).getTime();
    const end1 = new Date(event1.end.dateTime).getTime();
    const start2 = new Date(event2.start.dateTime).getTime();
    const end2 = new Date(event2.end.dateTime).getTime();

    return start1 < end2 && start2 < end1;
  }

  private calculateOverlap(event1: any, event2: any): number {
    const start1 = new Date(event1.start.dateTime).getTime();
    const end1 = new Date(event1.end.dateTime).getTime();
    const start2 = new Date(event2.start.dateTime).getTime();
    const end2 = new Date(event2.end.dateTime).getTime();

    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);

    return Math.max(0, overlapEnd - overlapStart) / (1000 * 60); // minutes
  }
}

class EmailSensor extends Sensor {
  constructor(
    private googleWorkspace: GoogleWorkspaceService,
    private vertexAI: VertexAIService
  ) {
    super();
  }

  async collect(): Promise<any> {
    // This should implement Gmail API calls to get recent emails
    // Simplified version provided here due to complexity
    return {
      urgentEmails: [],
      meetingRelated: [],
      totalCount: 0
    };
  }
}

class DocumentSensor extends Sensor {
  constructor(private googleWorkspace: GoogleWorkspaceService) {
    super();
  }

  async collect(): Promise<any> {
    // This should implement Drive API calls to detect document changes
    return {
      recentUpdates: [],
      totalDocuments: 0
    };
  }
}

class ActivitySensor extends Sensor {
  async collect(): Promise<any> {
    // This should collect team activity data
    return {
      unusualPatterns: [],
      activityLevel: 'normal'
    };
  }
}

// Type definitions
interface SensorResult {
  name: string;
  data: any;
  error: Error | null;
}

interface Signal {
  id: string;
  type: string;
  urgency: 'low' | 'medium' | 'high';
  description: string;
  data: any;
  confidence: number;
  timestamp: Date;
}

interface Anomaly {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  affectedSignals: string[];
  confidence: number;
  timestamp: Date;
}

interface Opportunity {
  id: string;
  type: string;
  description: string;
  potentialImpact: 'low' | 'medium' | 'high';
  estimatedSavings: number;
  confidence: number;
  timestamp: Date;
  relatedSignals: string[];
}

interface Risk {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  probability: number;
  potentialImpact: 'low' | 'medium' | 'high';
  mitigationSuggestions: string[];
  timestamp: Date;
}

interface PerceptionResult {
  timestamp: Date;
  signals: Signal[];
  anomalies: Anomaly[];
  opportunities: Opportunity[];
  risks: Risk[];
  metadata: {
    sensorsActive: number;
    sensorsTotal: number;
    processingTime: number;
  };
}