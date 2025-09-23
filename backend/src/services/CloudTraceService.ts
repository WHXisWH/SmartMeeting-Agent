import { Logger } from '../utils/Logger.js';

interface TraceSpan {
  name: string;
  startTime: number;
  endTime?: number;
  attributes?: Record<string, string | number | boolean>;
  parent?: string;
  traceId?: string;
  spanId: string;
}

/**
 * Cloud Trace integration service for cross-component tracing
 * Tracks webhook → task → Workspace API call chains
 */
export class CloudTraceService {
  private logger = new Logger('CloudTraceService');
  private spans = new Map<string, TraceSpan>();
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.ENABLE_CLOUD_TRACE === 'true';
    if (this.enabled) {
      this.logger.info('Cloud Trace integration enabled');
    }
  }

  /**
   * Start a new trace span
   */
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parentSpanId?: string
  ): string {
    if (!this.enabled) return '';

    const spanId = this.generateSpanId();
    const traceId = parentSpanId ? this.getTraceId(parentSpanId) : this.generateTraceId();

    const span: TraceSpan = {
      name,
      startTime: Date.now(),
      attributes: attributes || {},
      parent: parentSpanId,
      traceId,
      spanId
    };

    this.spans.set(spanId, span);
    this.logger.debug(`Started span: ${name}`, { spanId, traceId, parentSpanId });

    return spanId;
  }

  /**
   * Finish a trace span
   */
  finishSpan(spanId: string, attributes?: Record<string, string | number | boolean>): void {
    if (!this.enabled || !spanId) return;

    const span = this.spans.get(spanId);
    if (!span) {
      this.logger.warn(`Span not found: ${spanId}`);
      return;
    }

    span.endTime = Date.now();
    if (attributes) {
      span.attributes = { ...span.attributes, ...attributes };
    }

    const duration = span.endTime - span.startTime;
    this.logger.debug(`Finished span: ${span.name}`, {
      spanId,
      traceId: span.traceId,
      duration: `${duration}ms`
    });

    // For production, this would export to Cloud Trace API
    // For now, we'll log structured data for monitoring
    this.exportSpanToLogs(span);

    // Clean up completed spans after a delay to allow for parent-child linking
    setTimeout(() => this.spans.delete(spanId), 30000);
  }

  /**
   * Add attributes to an existing span
   */
  addSpanAttributes(spanId: string, attributes: Record<string, string | number | boolean>): void {
    if (!this.enabled || !spanId) return;

    const span = this.spans.get(spanId);
    if (span) {
      span.attributes = { ...span.attributes, ...attributes };
    }
  }

  /**
   * Create a webhook trace context for incoming requests
   */
  startWebhookTrace(
    webhookType: 'gmail' | 'calendar',
    requestId: string,
    payload?: any
  ): string {
    const attributes: Record<string, string | number | boolean> = {
      'webhook.type': webhookType,
      'webhook.request_id': requestId,
      'component': 'webhook_handler'
    };

    if (payload) {
      if (payload.historyId) attributes['gmail.history_id'] = payload.historyId;
      if (payload.channelId) attributes['calendar.channel_id'] = payload.channelId;
    }

    return this.startSpan(`webhook.${webhookType}`, attributes);
  }

  /**
   * Create a task processing trace linked to webhook
   */
  startTaskTrace(
    taskType: 'gmail_history' | 'calendar_ping',
    webhookSpanId?: string,
    taskData?: any
  ): string {
    const attributes: Record<string, string | number | boolean> = {
      'task.type': taskType,
      'component': 'task_processor'
    };

    if (taskData) {
      if (taskData.tenantId) attributes['tenant.id'] = taskData.tenantId;
      if (taskData.idempotencyKey) attributes['task.idempotency_key'] = taskData.idempotencyKey;
    }

    return this.startSpan(`task.${taskType}`, attributes, webhookSpanId);
  }

  /**
   * Create a Workspace API trace linked to task
   */
  startWorkspaceTrace(
    apiType: 'gmail' | 'calendar' | 'drive' | 'docs',
    operation: string,
    taskSpanId?: string
  ): string {
    const attributes: Record<string, string | number | boolean> = {
      'workspace.api': apiType,
      'workspace.operation': operation,
      'component': 'workspace_api'
    };

    return this.startSpan(`workspace.${apiType}.${operation}`, attributes, taskSpanId);
  }

  /**
   * Get trace context for HTTP headers (for external service calls)
   */
  getTraceContext(spanId: string): string | null {
    if (!this.enabled || !spanId) return null;

    const span = this.spans.get(spanId);
    if (!span) return null;

    // Format compatible with Cloud Trace
    return `${span.traceId}/${span.spanId};o=1`;
  }

  /**
   * Export span data to structured logs for Cloud Monitoring
   */
  private exportSpanToLogs(span: TraceSpan): void {
    const logData = {
      timestamp: new Date(span.startTime).toISOString(),
      severity: 'INFO',
      component: 'cloud_trace',
      trace: span.traceId,
      span: span.spanId,
      parent: span.parent,
      operation: span.name,
      duration_ms: span.endTime ? span.endTime - span.startTime : undefined,
      attributes: span.attributes,
      // Cloud Logging trace format for automatic correlation
      'logging.googleapis.com/trace': `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/traces/${span.traceId}`,
      'logging.googleapis.com/spanId': span.spanId
    };

    this.logger.info('Trace span completed', logData);
  }

  /**
   * Generate a unique span ID
   */
  private generateSpanId(): string {
    return Math.random().toString(16).slice(2, 18).padStart(16, '0');
  }

  /**
   * Generate a unique trace ID
   */
  private generateTraceId(): string {
    return Math.random().toString(16).slice(2, 34).padStart(32, '0');
  }

  /**
   * Get trace ID from parent span
   */
  private getTraceId(parentSpanId: string): string {
    const parentSpan = this.spans.get(parentSpanId);
    return parentSpan?.traceId || this.generateTraceId();
  }

  /**
   * Helper to trace a function execution
   */
  async traceFunction<T>(
    name: string,
    fn: (spanId: string) => Promise<T>,
    attributes?: Record<string, string | number | boolean>,
    parentSpanId?: string
  ): Promise<T> {
    const spanId = this.startSpan(name, attributes, parentSpanId);
    try {
      const result = await fn(spanId);
      this.finishSpan(spanId, { success: true });
      return result;
    } catch (error) {
      this.finishSpan(spanId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get current tracing status
   */
  getStatus(): { enabled: boolean; activeSpans: number } {
    return {
      enabled: this.enabled,
      activeSpans: this.spans.size
    };
  }
}