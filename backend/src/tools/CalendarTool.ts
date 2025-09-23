/**
 * CalendarTool - 第2阶段兼容层实现
 * 
 * 提供统一的Calendar API接口，供Vertex AI Agent Builder调用
 * 基于现有GoogleWorkspaceService但封装为标准化工具接口
 */

import { BaseTool, ToolDefinition, ToolExecutionResult, ToolParameter } from './ToolInterface.js';
import { GoogleWorkspaceService } from '../services/GoogleWorkspaceService.js';
import { Logger } from '../utils/Logger.js';

export class CalendarTool extends BaseTool {
  private googleWorkspaceService: GoogleWorkspaceService | null = null;
  private logger: Logger;

  constructor() {
    super(
      'calendar_manager',
      'Comprehensive calendar management tool for meeting operations',
      'calendar'
    );
    this.logger = new Logger('CalendarTool');
  }

  public getDefinition(): ToolDefinition {
    const parameters: ToolParameter[] = [
      {
        name: 'action',
        type: 'string',
        description: 'Calendar action to perform',
        required: true,
        validation: {
          enum: [
            'get_events',
            'create_meeting',
            'update_meeting',
            'cancel_meeting',
            'detect_conflicts',
            'analyze_patterns',
            'batch_update'
          ]
        }
      },
      {
        name: 'timeMin',
        type: 'string',
        description: 'Start time for event queries (ISO string)',
        required: false
      },
      {
        name: 'timeMax',
        type: 'string',
        description: 'End time for event queries (ISO string)',
        required: false
      },
      {
        name: 'meeting',
        type: 'object',
        description: 'Meeting data for create/update operations',
        required: false
      },
      {
        name: 'eventId',
        type: 'string',
        description: 'Event ID for update/cancel operations',
        required: false
      },
      {
        name: 'participants',
        type: 'array',
        description: 'List of participant emails for conflict detection',
        required: false
      },
      {
        name: 'updates',
        type: 'array',
        description: 'Array of update objects for batch operations',
        required: false
      },
      {
        name: 'reason',
        type: 'string',
        description: 'Reason for meeting cancellation',
        required: false
      }
    ];

    return {
      name: this.name,
      description: this.description,
      category: this.category as any,
      parameters,
      examples: [
        {
          input: {
            action: 'get_events',
            timeMin: '2025-01-01T00:00:00Z',
            timeMax: '2025-01-02T00:00:00Z'
          },
          expectedOutput: { success: true, data: { events: [] } },
          description: 'Retrieve events for a specific date range'
        },
        {
          input: {
            action: 'detect_conflicts',
            timeMin: '2025-01-01T10:00:00Z',
            timeMax: '2025-01-01T11:00:00Z',
            participants: ['user1@example.com', 'user2@example.com']
          },
          expectedOutput: { success: true, data: { conflicts: [] } },
          description: 'Detect scheduling conflicts for participants'
        },
        {
          input: {
            action: 'create_meeting',
            meeting: {
              title: 'Project Sync',
              description: 'Weekly project synchronization',
              startTime: '2025-01-01T10:00:00Z',
              endTime: '2025-01-01T11:00:00Z',
              participants: [{ email: 'user@example.com', name: 'User' }]
            }
          },
          expectedOutput: { success: true, data: { eventId: 'event_123' } },
          description: 'Create a new meeting with participants'
        }
      ]
    };
  }

  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing CalendarTool...');
      
      // 创建GoogleWorkspaceService实例
      this.googleWorkspaceService = new GoogleWorkspaceService();
      
      // 验证必需的环境变量
      const requiredEnvVars = [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI'
      ];
      
      const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
      if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
      }

      this.isInitialized = true;
      this.logger.info('CalendarTool initialized successfully');
      
    } catch (error) {
      this.initializationError = error as Error;
      this.logger.error('CalendarTool initialization failed', error);
      throw error;
    }
  }

  public async execute(parameters: Record<string, any>): Promise<ToolExecutionResult> {
    if (!this.isInitialized || !this.googleWorkspaceService) {
      return this.createResult(false, null, 'CalendarTool not initialized');
    }

    // 验证输入参数
    const validation = this.validateParameters(parameters);
    if (!validation.valid) {
      return this.createResult(false, null, `Parameter validation failed: ${validation.errors.join(', ')}`);
    }

    const { action } = parameters;
    const startTime = Date.now();

    try {
      let result: any;
      
      switch (action) {
        case 'get_events':
          result = await this.handleGetEvents(parameters);
          break;
        case 'create_meeting':
          result = await this.handleCreateMeeting(parameters);
          break;
        case 'update_meeting':
          result = await this.handleUpdateMeeting(parameters);
          break;
        case 'cancel_meeting':
          result = await this.handleCancelMeeting(parameters);
          break;
        case 'detect_conflicts':
          result = await this.handleDetectConflicts(parameters);
          break;
        case 'analyze_patterns':
          result = await this.handleAnalyzePatterns(parameters);
          break;
        case 'batch_update':
          result = await this.handleBatchUpdate(parameters);
          break;
        default:
          return this.createResult(false, null, `Unknown action: ${action}`);
      }

      return this.createResult(true, result, undefined, {
        executionTime: Date.now() - startTime,
        action,
        confidence: 0.95
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      this.logger.error(`CalendarTool execution failed for action ${action}`, error);
      
      return this.createResult(false, null, errorMessage, {
        executionTime: Date.now() - startTime,
        action,
        confidence: 0.0
      });
    }
  }

  private async handleGetEvents(params: Record<string, any>): Promise<any> {
    const timeMin = params.timeMin ? new Date(params.timeMin) : undefined;
    const timeMax = params.timeMax ? new Date(params.timeMax) : undefined;
    
    const events = await this.googleWorkspaceService!.getEvents(timeMin, timeMax);
    
    return {
      events,
      count: events.length,
      timeRange: {
        start: timeMin?.toISOString(),
        end: timeMax?.toISOString()
      }
    };
  }

  private async handleCreateMeeting(params: Record<string, any>): Promise<any> {
    const { meeting } = params;
    
    if (!meeting) {
      throw new Error('Meeting data is required for create_meeting action');
    }

    // 转换时间格式
    const meetingData = {
      ...meeting,
      startTime: meeting.startTime ? new Date(meeting.startTime) : undefined,
      endTime: meeting.endTime ? new Date(meeting.endTime) : undefined
    };

    const eventId = await this.googleWorkspaceService!.createMeeting(meetingData);
    
    return {
      eventId,
      meeting: meetingData,
      created: true
    };
  }

  private async handleUpdateMeeting(params: Record<string, any>): Promise<any> {
    const { eventId, meeting } = params;
    
    if (!eventId) {
      throw new Error('Event ID is required for update_meeting action');
    }
    
    if (!meeting) {
      throw new Error('Meeting updates are required for update_meeting action');
    }

    // 转换时间格式
    const updates = {
      ...meeting,
      startTime: meeting.startTime ? new Date(meeting.startTime) : undefined,
      endTime: meeting.endTime ? new Date(meeting.endTime) : undefined
    };

    await this.googleWorkspaceService!.updateMeeting(eventId, updates);
    
    return {
      eventId,
      updates,
      updated: true
    };
  }

  private async handleCancelMeeting(params: Record<string, any>): Promise<any> {
    const { eventId, reason } = params;
    
    if (!eventId) {
      throw new Error('Event ID is required for cancel_meeting action');
    }

    await this.googleWorkspaceService!.cancelMeeting(eventId, reason);
    
    return {
      eventId,
      reason,
      cancelled: true
    };
  }

  private async handleDetectConflicts(params: Record<string, any>): Promise<any> {
    const { timeMin, timeMax, participants } = params;
    
    if (!timeMin || !timeMax) {
      throw new Error('timeMin and timeMax are required for detect_conflicts action');
    }
    
    if (!participants || !Array.isArray(participants)) {
      throw new Error('participants array is required for detect_conflicts action');
    }

    const startTime = new Date(timeMin);
    const endTime = new Date(timeMax);
    
    const conflicts = await this.googleWorkspaceService!.detectConflicts(startTime, endTime, participants);
    
    return {
      conflicts,
      conflictCount: conflicts.length,
      timeRange: { start: timeMin, end: timeMax },
      participants
    };
  }

  private async handleAnalyzePatterns(params: Record<string, any>): Promise<any> {
    const { timeMin, timeMax } = params;
    
    const startDate = timeMin ? new Date(timeMin) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 默认30天前
    const endDate = timeMax ? new Date(timeMax) : new Date(); // 默认今天
    
    const analysis = await this.googleWorkspaceService!.analyzeMeetingPatterns(startDate, endDate);
    
    return {
      ...analysis,
      analyzedPeriod: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    };
  }

  private async handleBatchUpdate(params: Record<string, any>): Promise<any> {
    const { updates } = params;
    
    if (!updates || !Array.isArray(updates)) {
      throw new Error('updates array is required for batch_update action');
    }

    await this.googleWorkspaceService!.batchUpdateEvents(updates);
    
    return {
      updatesProcessed: updates.length,
      batchComplete: true,
      updates
    };
  }
}