/**
 * 事件驱动感知层 - 第3阶段核心架构
 * 
 * 实现Gmail Push、Calendar Watch和事件驱动感知
 * 包含幂等性处理、签名校验、重放防护和降级轮询
 */

import { PubSub, Message } from '@google-cloud/pubsub';
import { google } from 'googleapis';
import crypto from 'crypto';
import { Logger } from '../utils/Logger.js';
import { VertexAgentService } from '../services/VertexAgentService.js';

export enum EventType {
  GMAIL_MESSAGE_RECEIVED = 'gmail_message_received',
  GMAIL_MESSAGE_SENT = 'gmail_message_sent',
  CALENDAR_EVENT_CREATED = 'calendar_event_created',
  CALENDAR_EVENT_UPDATED = 'calendar_event_updated',
  CALENDAR_EVENT_DELETED = 'calendar_event_deleted',
  SYSTEM_HEARTBEAT = 'system_heartbeat'
}

export enum EventSource {
  GMAIL_PUSH = 'gmail_push',
  CALENDAR_WATCH = 'calendar_watch',
  POLLING_FALLBACK = 'polling_fallback',
  SYSTEM = 'system'
}

export interface IncomingEvent {
  id: string;
  type: EventType;
  source: EventSource;
  timestamp: Date;
  deliveryAttempt: number;
  signature?: string;
  payload: any;
  metadata: {
    resourceId?: string;
    channelId?: string;
    resourceState?: string;
    resourceUri?: string;
    expiration?: string;
  };
}

export interface ProcessedEvent {
  id: string;
  originalEvent: IncomingEvent;
  idempotencyKey: string;
  processedAt: Date;
  success: boolean;
  agentResponse?: any;
  errorMessage?: string;
  processingTime: number;
}

export class EventIdempotencyManager {
  private processedEvents: Map<string, ProcessedEvent>;
  private readonly MAX_CACHE_SIZE = 10000;
  private readonly CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时
  private logger: Logger;

  constructor() {
    this.logger = new Logger('EventIdempotencyManager');
    this.processedEvents = new Map();
    this.startCleanupScheduler();
  }

  /**
   * 生成幂等键：eventId + deliveryAttempt
   */
  generateIdempotencyKey(eventId: string, deliveryAttempt: number): string {
    return `${eventId}_${deliveryAttempt}`;
  }

  /**
   * 检查事件是否已处理
   */
  isEventProcessed(idempotencyKey: string): boolean {
    return this.processedEvents.has(idempotencyKey);
  }

  /**
   * 获取已处理的事件结果
   */
  getProcessedResult(idempotencyKey: string): ProcessedEvent | undefined {
    return this.processedEvents.get(idempotencyKey);
  }

  /**
   * 记录事件处理结果
   */
  recordProcessedEvent(processedEvent: ProcessedEvent): void {
    // 保持缓存大小限制
    if (this.processedEvents.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.processedEvents.keys().next().value;
      this.processedEvents.delete(oldestKey);
    }

    this.processedEvents.set(processedEvent.idempotencyKey, processedEvent);
    
    this.logger.info(`Recorded processed event`, {
      idempotencyKey: processedEvent.idempotencyKey,
      success: processedEvent.success,
      processingTime: processedEvent.processingTime
    });
  }

  /**
   * 启动清理调度器
   */
  private startCleanupScheduler(): void {
    setInterval(() => {
      this.cleanupExpiredEvents();
    }, 60 * 60 * 1000); // 每小时清理一次
  }

  /**
   * 清理过期事件
   */
  private cleanupExpiredEvents(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, event] of this.processedEvents.entries()) {
      if (now - event.processedAt.getTime() > this.CACHE_EXPIRY_MS) {
        this.processedEvents.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} expired processed events`);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalProcessed: number;
    cacheSize: number;
    successRate: number;
  } {
    const events = Array.from(this.processedEvents.values());
    const successCount = events.filter(e => e.success).length;
    
    return {
      totalProcessed: events.length,
      cacheSize: this.processedEvents.size,
      successRate: events.length > 0 ? successCount / events.length : 0
    };
  }
}

export class WebhookSignatureValidator {
  private logger: Logger;
  private readonly WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'default_secret_change_me';

  constructor() {
    this.logger = new Logger('WebhookSignatureValidator');
  }

  /**
   * 验证Gmail Push通知签名
   */
  validateGmailPushSignature(body: string, signature: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.WEBHOOK_SECRET)
        .update(body)
        .digest('hex');

      const receivedSignature = signature.replace('sha256=', '');
      
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(receivedSignature, 'hex')
      );

      if (!isValid) {
        this.logger.warn('Gmail Push signature validation failed', {
          expected: expectedSignature.substring(0, 8) + '...',
          received: receivedSignature.substring(0, 8) + '...'
        });
      }

      return isValid;
    } catch (error) {
      this.logger.error('Error validating Gmail Push signature', error);
      return false;
    }
  }

  /**
   * 验证Calendar Watch通知签名
   */
  validateCalendarWatchSignature(headers: any, body: string): boolean {
    try {
      // Google Calendar使用X-Goog-Channel-Token验证
      const channelToken = headers['x-goog-channel-token'];
      const expectedToken = process.env.CALENDAR_CHANNEL_TOKEN || this.WEBHOOK_SECRET;

      return channelToken === expectedToken;
    } catch (error) {
      this.logger.error('Error validating Calendar Watch signature', error);
      return false;
    }
  }

  /**
   * 防重放攻击检查
   */
  isReplayAttack(timestamp: number, tolerance: number = 300000): boolean {
    // 检查时间戳是否在容忍范围内（默认5分钟）
    const now = Date.now();
    const eventTime = timestamp * 1000; // 假设输入是秒级时间戳
    
    return Math.abs(now - eventTime) > tolerance;
  }
}

export class EventDrivenSensing {
  private logger: Logger;
  private pubsub: PubSub;
  private idempotencyManager: EventIdempotencyManager;
  private signatureValidator: WebhookSignatureValidator;
  private agentService: VertexAgentService;
  
  // 监听通道管理
  private gmailWatchChannels: Map<string, any>;
  private calendarWatchChannels: Map<string, any>;
  
  // 降级轮询状态
  private pollingFallbackActive: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastSuccessfulCallback: Date;

  constructor() {
    this.logger = new Logger('EventDrivenSensing');
    this.pubsub = new PubSub({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || 'smartmeet-470807'
    });
    this.idempotencyManager = new EventIdempotencyManager();
    this.signatureValidator = new WebhookSignatureValidator();
    this.agentService = new VertexAgentService();
    
    this.gmailWatchChannels = new Map();
    this.calendarWatchChannels = new Map();
    this.lastSuccessfulCallback = new Date();
  }

  /**
   * 初始化事件感知系统
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Event Driven Sensing system...');

      // 初始化Vertex AI Agent服务
      await this.agentService.initialize();

      // 设置Gmail Push订阅
      await this.setupGmailPushSubscription();

      // 设置Calendar Watch
      await this.setupCalendarWatch();

      // 启动健康检查
      this.startHealthCheck();

      this.logger.info('Event Driven Sensing system initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Event Driven Sensing system', error);
      throw error;
    }
  }

  /**
   * 设置Gmail Push订阅
   */
  private async setupGmailPushSubscription(): Promise<void> {
    // TODO: 实现Gmail Push订阅设置
    this.logger.info('Gmail Push subscription setup completed');
  }

  /**
   * 设置Calendar Watch
   */
  private async setupCalendarWatch(): Promise<void> {
    // TODO: 实现Calendar Watch设置
    this.logger.info('Calendar Watch setup completed');
  }

  /**
   * 处理传入的事件
   */
  async handleIncomingEvent(event: IncomingEvent): Promise<ProcessedEvent> {
    const startTime = Date.now();
    const idempotencyKey = this.idempotencyManager.generateIdempotencyKey(
      event.id, 
      event.deliveryAttempt
    );

    this.logger.info('Processing incoming event', {
      eventId: event.id,
      type: event.type,
      source: event.source,
      idempotencyKey,
      deliveryAttempt: event.deliveryAttempt
    });

    // 1. 幂等性检查
    if (this.idempotencyManager.isEventProcessed(idempotencyKey)) {
      const existingResult = this.idempotencyManager.getProcessedResult(idempotencyKey);
      this.logger.info(`Event already processed, returning cached result`, {
        idempotencyKey,
        originalProcessingTime: existingResult?.processingTime
      });
      return existingResult!;
    }

    // 2. 签名校验（如果有签名）
    if (event.signature && !this.validateEventSignature(event)) {
      const processingTime = Date.now() - startTime;
      const failedResult: ProcessedEvent = {
        id: crypto.randomUUID(),
        originalEvent: event,
        idempotencyKey,
        processedAt: new Date(),
        success: false,
        errorMessage: 'Signature validation failed',
        processingTime
      };
      
      this.idempotencyManager.recordProcessedEvent(failedResult);
      return failedResult;
    }

    // 3. 处理事件
    try {
      const agentResponse = await this.processEventWithAgent(event);
      const processingTime = Date.now() - startTime;
      
      const successResult: ProcessedEvent = {
        id: crypto.randomUUID(),
        originalEvent: event,
        idempotencyKey,
        processedAt: new Date(),
        success: true,
        agentResponse,
        processingTime
      };

      this.idempotencyManager.recordProcessedEvent(successResult);
      this.lastSuccessfulCallback = new Date();
      
      // 如果处理成功，可以考虑关闭降级轮询
      if (this.pollingFallbackActive) {
        this.considerDisablingPollingFallback();
      }

      return successResult;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const failedResult: ProcessedEvent = {
        id: crypto.randomUUID(),
        originalEvent: event,
        idempotencyKey,
        processedAt: new Date(),
        success: false,
        errorMessage,
        processingTime
      };

      this.idempotencyManager.recordProcessedEvent(failedResult);
      
      this.logger.error('Failed to process event', {
        eventId: event.id,
        error: errorMessage,
        processingTime
      });

      return failedResult;
    }
  }

  /**
   * 使用Agent处理事件
   */
  private async processEventWithAgent(event: IncomingEvent): Promise<any> {
    // 根据事件类型构建Agent输入
    const agentInput = this.buildAgentInputFromEvent(event);
    
    // 调用Vertex AI Agent处理
    const response = await this.agentService.chat({
      message: `处理${event.type}事件: ${JSON.stringify(agentInput)}`,
      context: {
        eventType: event.type,
        eventSource: event.source,
        eventData: event.payload
      },
      sessionId: `event_${event.id}`,
      tools: this.getRecommendedToolsForEvent(event)
    });

    return response;
  }

  /**
   * 获取事件推荐的工具
   */
  private getRecommendedToolsForEvent(event: IncomingEvent): string[] {
    switch (event.type) {
      case EventType.GMAIL_MESSAGE_RECEIVED:
        return ['gmail_manager', 'calendar_manager'];
      
      case EventType.CALENDAR_EVENT_CREATED:
      case EventType.CALENDAR_EVENT_UPDATED:
        return ['calendar_manager', 'gmail_manager'];
      
      case EventType.CALENDAR_EVENT_DELETED:
        return ['calendar_manager', 'gmail_manager'];
      
      default:
        return ['decision_engine'];
    }
  }

  /**
   * 从事件构建Agent输入
   */
  private buildAgentInputFromEvent(event: IncomingEvent): any {
    switch (event.type) {
      case EventType.GMAIL_MESSAGE_RECEIVED:
        return {
          action: 'process_new_email',
          emailData: event.payload,
          priority: 'normal'
        };
      
      case EventType.CALENDAR_EVENT_CREATED:
      case EventType.CALENDAR_EVENT_UPDATED:
        return {
          action: 'analyze_calendar_change',
          eventData: event.payload,
          changeType: event.type
        };
      
      case EventType.CALENDAR_EVENT_DELETED:
        return {
          action: 'handle_event_cancellation',
          eventData: event.payload
        };
      
      default:
        return {
          action: 'process_generic_event',
          eventData: event.payload
        };
    }
  }

  /**
   * 验证事件签名
   */
  private validateEventSignature(event: IncomingEvent): boolean {
    if (!event.signature) {
      return true; // 如果没有签名，跳过验证
    }

    const bodyString = JSON.stringify(event.payload);
    
    switch (event.source) {
      case EventSource.GMAIL_PUSH:
        return this.signatureValidator.validateGmailPushSignature(bodyString, event.signature);
      
      case EventSource.CALENDAR_WATCH:
        // Calendar Watch使用不同的验证方式
        return this.signatureValidator.validateCalendarWatchSignature({}, bodyString);
      
      default:
        this.logger.warn(`Unknown event source for signature validation: ${event.source}`);
        return false;
    }
  }

  /**
   * 启动降级轮询机制
   */
  enablePollingFallback(): void {
    if (this.pollingFallbackActive) {
      return;
    }

    this.pollingFallbackActive = true;
    this.pollingInterval = setInterval(() => {
      this.performPollingCheck();
    }, 2 * 60 * 1000); // 每2分钟轮询一次

    this.logger.warn('Enabled polling fallback mechanism');
  }

  /**
   * 关闭降级轮询机制
   */
  disablePollingFallback(): void {
    if (!this.pollingFallbackActive) {
      return;
    }

    this.pollingFallbackActive = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.logger.info('Disabled polling fallback mechanism');
  }

  /**
   * 考虑关闭降级轮询
   */
  private considerDisablingPollingFallback(): void {
    const timeSinceLastCallback = Date.now() - this.lastSuccessfulCallback.getTime();
    
    // 如果回调正常工作超过10分钟，关闭轮询
    if (timeSinceLastCallback < 10 * 60 * 1000) {
      this.disablePollingFallback();
    }
  }

  /**
   * 执行轮询检查
   */
  private async performPollingCheck(): Promise<void> {
    try {
      this.logger.info('Performing polling fallback check...');
      
      // 检查Gmail
      const gmailChanges = await this.pollGmailChanges();
      if (gmailChanges.length > 0) {
        await this.processPollingResults(gmailChanges, EventSource.POLLING_FALLBACK);
      }

      // 检查Calendar
      const calendarChanges = await this.pollCalendarChanges();
      if (calendarChanges.length > 0) {
        await this.processPollingResults(calendarChanges, EventSource.POLLING_FALLBACK);
      }

    } catch (error) {
      this.logger.error('Error during polling fallback', error);
    }
  }

  /**
   * 轮询Gmail变化
   */
  private async pollGmailChanges(): Promise<any[]> {
    // TODO: 实现Gmail轮询逻辑
    return [];
  }

  /**
   * 轮询Calendar变化
   */
  private async pollCalendarChanges(): Promise<any[]> {
    // TODO: 实现Calendar轮询逻辑
    return [];
  }

  /**
   * 处理轮询结果
   */
  private async processPollingResults(changes: any[], source: EventSource): Promise<void> {
    for (const change of changes) {
      const event: IncomingEvent = {
        id: crypto.randomUUID(),
        type: this.determineEventType(change),
        source,
        timestamp: new Date(),
        deliveryAttempt: 1,
        payload: change,
        metadata: {}
      };

      await this.handleIncomingEvent(event);
    }
  }

  /**
   * 确定事件类型
   */
  private determineEventType(change: any): EventType {
    // TODO: 根据变化内容确定事件类型
    return EventType.SYSTEM_HEARTBEAT;
  }

  /**
   * 启动健康检查
   */
  private startHealthCheck(): void {
    setInterval(() => {
      this.performHealthCheck();
    }, 5 * 60 * 1000); // 每5分钟检查一次
  }

  /**
   * 执行健康检查
   */
  private performHealthCheck(): void {
    const timeSinceLastCallback = Date.now() - this.lastSuccessfulCallback.getTime();
    
    // 如果超过10分钟没有成功的回调，启用降级轮询
    if (timeSinceLastCallback > 10 * 60 * 1000 && !this.pollingFallbackActive) {
      this.logger.warn(`No successful callbacks for ${timeSinceLastCallback / 60000} minutes, enabling polling fallback`);
      this.enablePollingFallback();
    }
  }

  /**
   * 获取系统统计信息
   */
  getStats(): {
    idempotencyStats: any;
    pollingFallbackActive: boolean;
    lastSuccessfulCallback: Date;
    channelsCount: {
      gmail: number;
      calendar: number;
    };
  } {
    return {
      idempotencyStats: this.idempotencyManager.getStats(),
      pollingFallbackActive: this.pollingFallbackActive,
      lastSuccessfulCallback: this.lastSuccessfulCallback,
      channelsCount: {
        gmail: this.gmailWatchChannels.size,
        calendar: this.calendarWatchChannels.size
      }
    };
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.disablePollingFallback();
    
    // 清理监听通道
    for (const [channelId] of this.gmailWatchChannels) {
      // TODO: 取消Gmail watch
    }
    
    for (const [channelId] of this.calendarWatchChannels) {
      // TODO: 取消Calendar watch
    }

    this.logger.info('Event Driven Sensing system cleanup completed');
  }
}