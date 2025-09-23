/**
 * Calendar Watch 处理器 - 第3阶段
 * 
 * 实现Google Calendar的Watch API监听和处理逻辑
 * 包含通道管理、过期续订和事件转换
 */

import { google } from 'googleapis';
import crypto from 'crypto';
import { Logger } from '../utils/Logger.js';
import { EventDrivenSensing, IncomingEvent, EventType, EventSource } from './EventSensing.js';

export interface CalendarWatchChannel {
  id: string;
  resourceId: string;
  resourceUri: string;
  token: string;
  expiration: number;
  type: 'web_hook';
  address: string;
  calendarId: string;
  created: Date;
}

export interface CalendarWebhookPayload {
  channelId: string;
  channelToken: string;
  resourceId: string;
  resourceState: 'exists' | 'not_exists' | 'sync';
  resourceUri: string;
  eventId?: string;
  eventType?: string;
}

export class CalendarWatchHandler {
  private logger: Logger;
  private calendar: any;
  private eventSensing: EventDrivenSensing;
  private activeChannels: Map<string, CalendarWatchChannel>;
  private webhookEndpoint: string;
  
  private readonly CHANNEL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7天
  private readonly RENEWAL_ADVANCE_MS = 60 * 60 * 1000; // 提前1小时续订

  constructor(eventSensing: EventDrivenSensing, webhookEndpoint: string) {
    this.logger = new Logger('CalendarWatchHandler');
    this.eventSensing = eventSensing;
    this.webhookEndpoint = webhookEndpoint;
    this.activeChannels = new Map();

    // 初始化Google Calendar API客户端
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  /**
   * 设置Calendar Watch监听
   */
  async setupCalendarWatch(calendarIds: string[] = ['primary']): Promise<void> {
    try {
      this.logger.info('Setting up Calendar Watch notifications...');

      for (const calendarId of calendarIds) {
        await this.createWatchChannel(calendarId);
      }

      // 启动通道健康检查
      this.startChannelHealthCheck();

      this.logger.info(`Calendar Watch setup completed for ${calendarIds.length} calendars`);
    } catch (error) {
      this.logger.error('Failed to setup Calendar Watch', error);
      throw error;
    }
  }

  /**
   * 创建Watch通道
   */
  private async createWatchChannel(calendarId: string): Promise<CalendarWatchChannel> {
    try {
      const channelId = `calendar_${calendarId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const token = crypto.randomUUID();
      const expiration = Date.now() + this.CHANNEL_EXPIRY_MS;

      const watchRequest = {
        calendarId: calendarId,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: `${this.webhookEndpoint}/webhooks/calendar`,
          token: token,
          expiration: expiration.toString()
        }
      };

      const response = await this.calendar.events.watch(watchRequest);

      const channel: CalendarWatchChannel = {
        id: channelId,
        resourceId: response.data.resourceId,
        resourceUri: response.data.resourceUri,
        token: token,
        expiration: expiration,
        type: 'web_hook',
        address: watchRequest.requestBody.address,
        calendarId: calendarId,
        created: new Date()
      };

      this.activeChannels.set(channelId, channel);

      this.logger.info('Calendar watch channel created', {
        channelId,
        calendarId,
        resourceId: response.data.resourceId,
        expiration: new Date(expiration).toISOString()
      });

      // 调度续订
      this.scheduleChannelRenewal(channel);

      return channel;
    } catch (error) {
      this.logger.error('Failed to create Calendar watch channel', {
        calendarId,
        error
      });
      throw error;
    }
  }

  /**
   * 处理Calendar Webhook通知
   */
  async handleCalendarWebhook(
    headers: any,
    body: any,
    channelId: string,
    resourceState: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.info('Processing Calendar webhook notification', {
        channelId,
        resourceState,
        resourceId: headers['x-goog-resource-id'],
        resourceUri: headers['x-goog-resource-uri']
      });

      // 1. 验证通道存在性
      const channel = this.activeChannels.get(channelId);
      if (!channel) {
        this.logger.warn('Received webhook for unknown channel', { channelId });
        return;
      }

      // 2. 验证Token
      const channelToken = headers['x-goog-channel-token'];
      if (channelToken !== channel.token) {
        this.logger.error('Channel token validation failed', {
          channelId,
          expected: channel.token.substring(0, 8) + '...',
          received: (channelToken || '').substring(0, 8) + '...'
        });
        return;
      }

      // 3. 处理同步消息
      if (resourceState === 'sync') {
        this.logger.info('Received Calendar sync message', { channelId });
        return;
      }

      // 4. 获取日历变更
      const changes = await this.getCalendarChanges(channel);

      // 5. 处理每个变更
      for (const change of changes) {
        await this.processCalendarChange(change, channel);
      }

      const processingTime = Date.now() - startTime;
      this.logger.info('Calendar webhook processed successfully', {
        channelId,
        changesCount: changes.length,
        processingTime
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error('Failed to process Calendar webhook', {
        channelId,
        resourceState,
        error: error instanceof Error ? error.message : error,
        processingTime
      });
    }
  }

  /**
   * 获取日历变更
   */
  private async getCalendarChanges(channel: CalendarWatchChannel): Promise<any[]> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // 获取最近的事件变更
      const response = await this.calendar.events.list({
        calendarId: channel.calendarId,
        updatedMin: oneHourAgo.toISOString(),
        showDeleted: true,
        singleEvents: false,
        orderBy: 'updated'
      });

      return response.data.items || [];
    } catch (error) {
      this.logger.error('Failed to get calendar changes', {
        channelId: channel.id,
        calendarId: channel.calendarId,
        error
      });
      return [];
    }
  }

  /**
   * 处理日历变更
   */
  private async processCalendarChange(
    eventData: any,
    channel: CalendarWatchChannel
  ): Promise<void> {
    try {
      // 确定事件类型
      const eventType = this.determineEventType(eventData);
      
      // 构建传入事件
      const incomingEvent: IncomingEvent = {
        id: `cal_${eventData.id || 'unknown'}_${Date.now()}`,
        type: eventType,
        source: EventSource.CALENDAR_WATCH,
        timestamp: new Date(),
        deliveryAttempt: 1,
        payload: {
          calendarId: channel.calendarId,
          eventId: eventData.id,
          eventData: eventData,
          summary: eventData.summary,
          start: eventData.start,
          end: eventData.end,
          attendees: eventData.attendees,
          status: eventData.status,
          updated: eventData.updated,
          created: eventData.created
        },
        metadata: {
          channelId: channel.id,
          resourceId: channel.resourceId,
          resourceState: eventData.status === 'cancelled' ? 'deleted' : 'exists',
          resourceUri: channel.resourceUri
        }
      };

      // 发送给事件感知系统处理
      await this.eventSensing.handleIncomingEvent(incomingEvent);

    } catch (error) {
      this.logger.error('Failed to process calendar change', {
        eventId: eventData.id,
        channelId: channel.id,
        error
      });
    }
  }

  /**
   * 确定事件类型
   */
  private determineEventType(eventData: any): EventType {
    if (!eventData.created || !eventData.updated) {
      return EventType.CALENDAR_EVENT_UPDATED;
    }

    const created = new Date(eventData.created);
    const updated = new Date(eventData.updated);
    
    // 如果状态是cancelled，认为是删除事件
    if (eventData.status === 'cancelled') {
      return EventType.CALENDAR_EVENT_DELETED;
    }

    // 如果创建时间和更新时间相近（1分钟内），认为是新创建
    if (Math.abs(updated.getTime() - created.getTime()) < 60 * 1000) {
      return EventType.CALENDAR_EVENT_CREATED;
    }

    return EventType.CALENDAR_EVENT_UPDATED;
  }

  /**
   * 启动通道健康检查
   */
  private startChannelHealthCheck(): void {
    setInterval(() => {
      this.performChannelHealthCheck();
    }, 10 * 60 * 1000); // 每10分钟检查一次

    this.logger.info('Started Calendar channel health check');
  }

  /**
   * 执行通道健康检查
   */
  private performChannelHealthCheck(): void {
    const now = Date.now();
    const expiringSoon: CalendarWatchChannel[] = [];
    const expired: CalendarWatchChannel[] = [];

    for (const [channelId, channel] of this.activeChannels) {
      const timeToExpiry = channel.expiration - now;
      
      if (timeToExpiry <= 0) {
        expired.push(channel);
      } else if (timeToExpiry <= this.RENEWAL_ADVANCE_MS) {
        expiringSoon.push(channel);
      }
    }

    // 处理过期的通道
    for (const channel of expired) {
      this.handleExpiredChannel(channel);
    }

    // 续订即将过期的通道
    for (const channel of expiringSoon) {
      this.renewChannel(channel);
    }

    if (expiringSoon.length > 0 || expired.length > 0) {
      this.logger.info('Channel health check completed', {
        total: this.activeChannels.size,
        expiringSoon: expiringSoon.length,
        expired: expired.length
      });
    }
  }

  /**
   * 调度通道续订
   */
  private scheduleChannelRenewal(channel: CalendarWatchChannel): void {
    const renewTime = channel.expiration - this.RENEWAL_ADVANCE_MS;
    const delay = renewTime - Date.now();

    if (delay > 0) {
      setTimeout(() => {
        this.renewChannel(channel);
      }, delay);

      this.logger.info('Calendar channel renewal scheduled', {
        channelId: channel.id,
        expiration: new Date(channel.expiration).toISOString(),
        renewAt: new Date(renewTime).toISOString()
      });
    } else {
      // 如果已经需要续订，立即处理
      this.renewChannel(channel);
    }
  }

  /**
   * 续订通道
   */
  private async renewChannel(channel: CalendarWatchChannel): Promise<void> {
    try {
      this.logger.info('Renewing Calendar channel', {
        channelId: channel.id,
        calendarId: channel.calendarId
      });

      // 停止旧通道
      await this.stopChannel(channel);

      // 创建新通道
      await this.createWatchChannel(channel.calendarId);

      this.logger.info('Calendar channel renewed successfully', {
        oldChannelId: channel.id,
        calendarId: channel.calendarId
      });

    } catch (error) {
      this.logger.error('Failed to renew Calendar channel', {
        channelId: channel.id,
        calendarId: channel.calendarId,
        error
      });

      // 如果续订失败，5分钟后重试
      setTimeout(() => {
        this.renewChannel(channel);
      }, 5 * 60 * 1000);
    }
  }

  /**
   * 处理过期通道
   */
  private async handleExpiredChannel(channel: CalendarWatchChannel): Promise<void> {
    this.logger.warn('Handling expired Calendar channel', {
      channelId: channel.id,
      calendarId: channel.calendarId,
      expiredSince: Date.now() - channel.expiration
    });

    // 移除过期通道
    this.activeChannels.delete(channel.id);

    // 尝试创建新通道
    try {
      await this.createWatchChannel(channel.calendarId);
    } catch (error) {
      this.logger.error('Failed to recreate expired channel', {
        channelId: channel.id,
        calendarId: channel.calendarId,
        error
      });
    }
  }

  /**
   * 停止通道
   */
  private async stopChannel(channel: CalendarWatchChannel): Promise<void> {
    try {
      await this.calendar.channels.stop({
        requestBody: {
          id: channel.id,
          resourceId: channel.resourceId
        }
      });

      this.activeChannels.delete(channel.id);
      
      this.logger.info('Calendar channel stopped', {
        channelId: channel.id,
        calendarId: channel.calendarId
      });

    } catch (error) {
      // 即使停止失败也要从本地移除通道记录
      this.activeChannels.delete(channel.id);
      
      this.logger.error('Failed to stop Calendar channel', {
        channelId: channel.id,
        error
      });
    }
  }

  /**
   * 停止所有Calendar Watch通知
   */
  async stopAllCalendarWatchNotifications(): Promise<void> {
    this.logger.info('Stopping all Calendar watch notifications...');

    const stopPromises: Promise<void>[] = [];
    
    for (const [channelId, channel] of this.activeChannels) {
      stopPromises.push(this.stopChannel(channel));
    }

    try {
      await Promise.all(stopPromises);
      this.logger.info('All Calendar watch notifications stopped');
    } catch (error) {
      this.logger.error('Some Calendar channels failed to stop', error);
    }
  }

  /**
   * 验证Webhook签名
   */
  validateWebhookSignature(headers: any, body: string): boolean {
    const channelToken = headers['x-goog-channel-token'];
    const channelId = headers['x-goog-channel-id'];
    
    if (!channelId || !channelToken) {
      this.logger.warn('Missing required webhook headers', {
        hasChannelId: !!channelId,
        hasChannelToken: !!channelToken
      });
      return false;
    }

    const channel = this.activeChannels.get(channelId);
    if (!channel) {
      this.logger.warn('Webhook for unknown channel', { channelId });
      return false;
    }

    return channelToken === channel.token;
  }

  /**
   * 获取Calendar Watch统计
   */
  getStats(): {
    activeChannels: number;
    channelsByCalendar: { [calendarId: string]: number };
    nextExpiration: Date | null;
    oldestChannel: Date | null;
  } {
    const channelsByCalendar: { [calendarId: string]: number } = {};
    let nextExpiration: number | null = null;
    let oldestChannelTime: number | null = null;

    for (const [channelId, channel] of this.activeChannels) {
      // 统计每个日历的通道数
      channelsByCalendar[channel.calendarId] = (channelsByCalendar[channel.calendarId] || 0) + 1;
      
      // 找到最近的过期时间
      if (nextExpiration === null || channel.expiration < nextExpiration) {
        nextExpiration = channel.expiration;
      }
      
      // 找到最老的通道
      const channelTime = channel.created.getTime();
      if (oldestChannelTime === null || channelTime < oldestChannelTime) {
        oldestChannelTime = channelTime;
      }
    }

    return {
      activeChannels: this.activeChannels.size,
      channelsByCalendar,
      nextExpiration: nextExpiration ? new Date(nextExpiration) : null,
      oldestChannel: oldestChannelTime ? new Date(oldestChannelTime) : null
    };
  }

  /**
   * 获取活跃通道列表
   */
  getActiveChannels(): CalendarWatchChannel[] {
    return Array.from(this.activeChannels.values());
  }
}