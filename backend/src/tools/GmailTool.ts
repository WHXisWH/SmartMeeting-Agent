/**
 * GmailTool - 第2阶段兼容层实现
 * 
 * 提供统一的Gmail API接口，供Vertex AI Agent Builder调用
 * 基于现有GoogleWorkspaceService的邮件功能
 */

import { BaseTool, ToolDefinition, ToolExecutionResult, ToolParameter } from './ToolInterface.js';
import { GoogleWorkspaceService } from '../services/GoogleWorkspaceService.js';
import { Logger } from '../utils/Logger.js';

export class GmailTool extends BaseTool {
  private googleWorkspaceService: GoogleWorkspaceService | null = null;
  private logger: Logger;

  constructor() {
    super(
      'gmail_manager',
      'Comprehensive Gmail management tool for email operations and notifications',
      'gmail'
    );
    this.logger = new Logger('GmailTool');
  }

  public getDefinition(): ToolDefinition {
    const parameters: ToolParameter[] = [
      {
        name: 'action',
        type: 'string',
        description: 'Gmail action to perform',
        required: true,
        validation: {
          enum: [
            'send_email',
            'send_meeting_invite',
            'send_cancellation_notice',
            'send_update_notification',
            'send_reminder',
            'send_summary',
            'setup_watch'
          ]
        }
      },
      {
        name: 'to',
        type: 'array',
        description: 'Array of recipient email addresses',
        required: false
      },
      {
        name: 'subject',
        type: 'string',
        description: 'Email subject line',
        required: false
      },
      {
        name: 'body',
        type: 'string',
        description: 'Email body content (HTML supported)',
        required: false
      },
      {
        name: 'meeting',
        type: 'object',
        description: 'Meeting data for meeting-related emails',
        required: false
      },
      {
        name: 'reason',
        type: 'string',
        description: 'Reason for cancellation or update',
        required: false
      },
      {
        name: 'attachments',
        type: 'array',
        description: 'Array of attachment objects',
        required: false
      },
      {
        name: 'template',
        type: 'string',
        description: 'Email template type',
        required: false,
        validation: {
          enum: [
            'meeting_invite',
            'meeting_cancellation',
            'meeting_update',
            'meeting_reminder',
            'meeting_summary',
            'conflict_notification',
            'optimization_suggestion'
          ]
        }
      },
      {
        name: 'templateData',
        type: 'object',
        description: 'Data to populate email template',
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
            action: 'send_email',
            to: ['user@example.com'],
            subject: 'Test Email',
            body: 'This is a test email from SmartMeet Agent'
          },
          expectedOutput: { success: true, data: { sent: true } },
          description: 'Send a simple email'
        },
        {
          input: {
            action: 'send_cancellation_notice',
            to: ['user1@example.com', 'user2@example.com'],
            meeting: { title: 'Project Sync', id: 'event_123' },
            reason: 'Scheduling conflict resolved'
          },
          expectedOutput: { success: true, data: { sent: true, type: 'cancellation' } },
          description: 'Send meeting cancellation notification'
        },
        {
          input: {
            action: 'send_email',
            template: 'meeting_reminder',
            to: ['user@example.com'],
            templateData: {
              meetingTitle: 'Weekly Standup',
              startTime: '2025-01-01T10:00:00Z',
              location: 'Conference Room A'
            }
          },
          expectedOutput: { success: true, data: { sent: true, template: 'meeting_reminder' } },
          description: 'Send templated meeting reminder'
        }
      ]
    };
  }

  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing GmailTool...');
      
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
      this.logger.info('GmailTool initialized successfully');
      
    } catch (error) {
      this.initializationError = error as Error;
      this.logger.error('GmailTool initialization failed', error);
      throw error;
    }
  }

  public async execute(parameters: Record<string, any>): Promise<ToolExecutionResult> {
    if (!this.isInitialized || !this.googleWorkspaceService) {
      return this.createResult(false, null, 'GmailTool not initialized');
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
        case 'send_email':
          result = await this.handleSendEmail(parameters);
          break;
        case 'send_meeting_invite':
          result = await this.handleSendMeetingInvite(parameters);
          break;
        case 'send_cancellation_notice':
          result = await this.handleSendCancellation(parameters);
          break;
        case 'send_update_notification':
          result = await this.handleSendUpdate(parameters);
          break;
        case 'send_reminder':
          result = await this.handleSendReminder(parameters);
          break;
        case 'send_summary':
          result = await this.handleSendSummary(parameters);
          break;
        case 'setup_watch':
          result = await this.handleSetupWatch(parameters);
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
      this.logger.error(`GmailTool execution failed for action ${action}`, error);
      
      return this.createResult(false, null, errorMessage, {
        executionTime: Date.now() - startTime,
        action,
        confidence: 0.0
      });
    }
  }

  private async handleSendEmail(params: Record<string, any>): Promise<any> {
    const { to, subject, body, attachments, template, templateData } = params;
    
    if (!to || !Array.isArray(to) || to.length === 0) {
      throw new Error('Recipients (to) array is required and must not be empty');
    }

    let emailSubject = subject;
    let emailBody = body;

    // 如果指定了模板，使用模板生成内容
    if (template && templateData) {
      const templateResult = this.generateEmailFromTemplate(template, templateData);
      emailSubject = templateResult.subject;
      emailBody = templateResult.body;
    }

    if (!emailSubject || !emailBody) {
      throw new Error('Subject and body are required (either directly or through template)');
    }

    await this.googleWorkspaceService!.sendEmail(to, emailSubject, emailBody, attachments);
    
    return {
      sent: true,
      to,
      subject: emailSubject,
      template: template || null,
      timestamp: new Date().toISOString()
    };
  }

  private async handleSendMeetingInvite(params: Record<string, any>): Promise<any> {
    const { to, meeting } = params;
    
    if (!to || !Array.isArray(to)) {
      throw new Error('Recipients (to) array is required for meeting invites');
    }
    
    if (!meeting) {
      throw new Error('Meeting data is required for meeting invites');
    }

    const subject = `会议邀请: ${meeting.title || 'Meeting'}`;
    const body = this.generateMeetingInviteBody(meeting);

    await this.googleWorkspaceService!.sendEmail(to, subject, body);
    
    return {
      sent: true,
      type: 'meeting_invite',
      to,
      meeting,
      timestamp: new Date().toISOString()
    };
  }

  private async handleSendCancellation(params: Record<string, any>): Promise<any> {
    const { to, meeting, reason } = params;
    
    if (!to || !Array.isArray(to)) {
      throw new Error('Recipients (to) array is required for cancellation notices');
    }
    
    if (!meeting || !meeting.title) {
      throw new Error('Meeting data with title is required for cancellation notices');
    }

    // 使用GoogleWorkspaceService的专用方法
    await this.googleWorkspaceService!.sendCancellationEmail(to, meeting.title, reason || '会议安排变更');
    
    return {
      sent: true,
      type: 'cancellation',
      to,
      meeting,
      reason,
      timestamp: new Date().toISOString()
    };
  }

  private async handleSendUpdate(params: Record<string, any>): Promise<any> {
    const { to, meeting, reason } = params;
    
    if (!to || !Array.isArray(to)) {
      throw new Error('Recipients (to) array is required for update notifications');
    }
    
    if (!meeting) {
      throw new Error('Meeting data is required for update notifications');
    }

    const subject = `会议更新通知: ${meeting.title || 'Meeting'}`;
    const body = this.generateMeetingUpdateBody(meeting, reason);

    await this.googleWorkspaceService!.sendEmail(to, subject, body);
    
    return {
      sent: true,
      type: 'update',
      to,
      meeting,
      reason,
      timestamp: new Date().toISOString()
    };
  }

  private async handleSendReminder(params: Record<string, any>): Promise<any> {
    const { to, meeting, templateData } = params;
    
    if (!to || !Array.isArray(to)) {
      throw new Error('Recipients (to) array is required for reminders');
    }
    
    const meetingData = meeting || templateData?.meeting;
    if (!meetingData) {
      throw new Error('Meeting data is required for reminders');
    }

    const subject = `会议提醒: ${meetingData.title || 'Meeting'}`;
    const body = this.generateMeetingReminderBody(meetingData);

    await this.googleWorkspaceService!.sendEmail(to, subject, body);
    
    return {
      sent: true,
      type: 'reminder',
      to,
      meeting: meetingData,
      timestamp: new Date().toISOString()
    };
  }

  private async handleSendSummary(params: Record<string, any>): Promise<any> {
    const { to, meeting, templateData } = params;
    
    if (!to || !Array.isArray(to)) {
      throw new Error('Recipients (to) array is required for summaries');
    }
    
    const meetingData = meeting || templateData?.meeting;
    if (!meetingData) {
      throw new Error('Meeting data is required for summaries');
    }

    const subject = `会议总结: ${meetingData.title || 'Meeting'}`;
    const body = this.generateMeetingSummaryBody(meetingData, templateData);

    await this.googleWorkspaceService!.sendEmail(to, subject, body);
    
    return {
      sent: true,
      type: 'summary',
      to,
      meeting: meetingData,
      timestamp: new Date().toISOString()
    };
  }

  private async handleSetupWatch(params: Record<string, any>): Promise<any> {
    await this.googleWorkspaceService!.setupGmailWatch();
    
    return {
      watchSetup: true,
      timestamp: new Date().toISOString()
    };
  }

  private generateEmailFromTemplate(template: string, data: any): { subject: string; body: string } {
    switch (template) {
      case 'meeting_invite':
        return {
          subject: `会议邀请: ${data.meetingTitle || 'Meeting'}`,
          body: this.generateMeetingInviteBody(data)
        };
      case 'meeting_reminder':
        return {
          subject: `会议提醒: ${data.meetingTitle || 'Meeting'}`,
          body: this.generateMeetingReminderBody(data)
        };
      case 'conflict_notification':
        return {
          subject: '日程冲突通知',
          body: this.generateConflictNotificationBody(data)
        };
      case 'optimization_suggestion':
        return {
          subject: '会议优化建议',
          body: this.generateOptimizationSuggestionBody(data)
        };
      default:
        throw new Error(`Unknown email template: ${template}`);
    }
  }

  private generateMeetingInviteBody(meeting: any): string {
    return `
    <html>
    <body>
      <p>您好，</p>
      <p>您被邀请参加以下会议：</p>
      <div style="border-left: 4px solid #4285F4; padding-left: 16px; margin: 16px 0;">
        <h3>${meeting.title || '会议'}</h3>
        <p><strong>时间：</strong> ${meeting.startTime ? new Date(meeting.startTime).toLocaleString() : '待定'}</p>
        <p><strong>时长：</strong> ${meeting.duration || '1小时'}</p>
        <p><strong>地点：</strong> ${meeting.location || '线上会议'}</p>
        ${meeting.description ? `<p><strong>描述：</strong> ${meeting.description}</p>` : ''}
      </div>
      <p>请确认您的参会状态。</p>
      <p>此邮件由SmartMeet AI Agent自动发送。</p>
    </body>
    </html>
    `;
  }

  private generateMeetingUpdateBody(meeting: any, reason?: string): string {
    return `
    <html>
    <body>
      <p>您好，</p>
      <p>会议 "${meeting.title || 'Meeting'}" 已更新。</p>
      ${reason ? `<p><strong>更新原因：</strong> ${reason}</p>` : ''}
      <div style="border-left: 4px solid #FF9800; padding-left: 16px; margin: 16px 0;">
        <h3>更新后的会议信息</h3>
        <p><strong>时间：</strong> ${meeting.startTime ? new Date(meeting.startTime).toLocaleString() : '待定'}</p>
        <p><strong>地点：</strong> ${meeting.location || '线上会议'}</p>
        ${meeting.description ? `<p><strong>描述：</strong> ${meeting.description}</p>` : ''}
      </div>
      <p>请查看您的日历获取最新信息。</p>
      <p>此邮件由SmartMeet AI Agent自动发送。</p>
    </body>
    </html>
    `;
  }

  private generateMeetingReminderBody(meeting: any): string {
    const startTime = meeting.startTime ? new Date(meeting.startTime) : null;
    const timeUntilMeeting = startTime ? Math.round((startTime.getTime() - Date.now()) / (1000 * 60)) : null;
    
    return `
    <html>
    <body>
      <p>您好，</p>
      <p>这是关于即将召开的会议的提醒：</p>
      <div style="border-left: 4px solid #4CAF50; padding-left: 16px; margin: 16px 0;">
        <h3>${meeting.title || '会议'}</h3>
        <p><strong>时间：</strong> ${startTime ? startTime.toLocaleString() : '待定'}</p>
        ${timeUntilMeeting ? `<p><strong>距离开始：</strong> ${timeUntilMeeting}分钟</p>` : ''}
        <p><strong>地点：</strong> ${meeting.location || '线上会议'}</p>
      </div>
      <p>请准时参加会议。</p>
      <p>此邮件由SmartMeet AI Agent自动发送。</p>
    </body>
    </html>
    `;
  }

  private generateMeetingSummaryBody(meeting: any, data: any): string {
    return `
    <html>
    <body>
      <p>您好，</p>
      <p>以下是会议 "${meeting.title || 'Meeting'}" 的总结：</p>
      <div style="border-left: 4px solid #9C27B0; padding-left: 16px; margin: 16px 0;">
        <h3>会议总结</h3>
        <p><strong>时间：</strong> ${meeting.startTime ? new Date(meeting.startTime).toLocaleString() : '未知'}</p>
        <p><strong>参与者：</strong> ${data?.participants || '待更新'}</p>
        <p><strong>主要议题：</strong> ${data?.topics || '待更新'}</p>
        <p><strong>决定事项：</strong> ${data?.decisions || '待更新'}</p>
        <p><strong>后续行动：</strong> ${data?.actionItems || '待更新'}</p>
      </div>
      <p>感谢参与本次会议。</p>
      <p>此邮件由SmartMeet AI Agent自动发送。</p>
    </body>
    </html>
    `;
  }

  private generateConflictNotificationBody(data: any): string {
    return `
    <html>
    <body>
      <p>您好，</p>
      <p>检测到您的日程中存在冲突：</p>
      <div style="border-left: 4px solid #F44336; padding-left: 16px; margin: 16px 0;">
        <h3>冲突详情</h3>
        <p><strong>冲突时间：</strong> ${data?.conflictTime || '待确定'}</p>
        <p><strong>涉及会议：</strong> ${data?.meetings?.join(', ') || '待确定'}</p>
      </div>
      <p>建议您调整日程以避免冲突。</p>
      <p>此邮件由SmartMeet AI Agent自动发送。</p>
    </body>
    </html>
    `;
  }

  private generateOptimizationSuggestionBody(data: any): string {
    return `
    <html>
    <body>
      <p>您好，</p>
      <p>SmartMeet AI Agent为您提供以下会议优化建议：</p>
      <div style="border-left: 4px solid #2196F3; padding-left: 16px; margin: 16px 0;">
        <h3>优化建议</h3>
        ${data?.suggestions?.map((suggestion: string) => `<p>• ${suggestion}</p>`).join('') || '<p>暂无建议</p>'}
      </div>
      <p>实施这些建议可能有助于提升会议效率。</p>
      <p>此邮件由SmartMeet AI Agent自动发送。</p>
    </body>
    </html>
    `;
  }
}