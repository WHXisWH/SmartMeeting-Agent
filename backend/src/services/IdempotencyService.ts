import { Firestore } from '@google-cloud/firestore';
import { Logger } from '../utils/Logger.js';

/**
 * IdempotencyService
 * EN/JA only: Provides simple Firestore-based idempotency guards for webhook processing
 */
export class IdempotencyService {
  private db: Firestore;
  private logger: Logger;

  constructor() {
    this.db = new Firestore();
    this.logger = new Logger('IdempotencyService');
  }

  /**
   * Mark Pub/Sub push messageId as processed.
   * Returns true if already processed, false if newly recorded.
   */
  async markPubSubProcessed(messageId: string): Promise<boolean> {
    const col = this.db.collection('webhook_idempotency_pubsub');
    const id = sanitizeId(messageId);
    try {
      await col.doc(id).create({
        createdAt: Date.now(),
        messageId,
      } as any);
      return false;
    } catch (e: any) {
      if (isAlreadyExists(e)) return true;
      this.logger.warn('PubSub idempotency create failed', { error: e?.message || String(e) });
      throw e;
    }
  }

  /**
   * Mark Gmail history (email + historyId) as processed.
   */
  async markGmailHistoryProcessed(emailAddress: string, historyId: string): Promise<boolean> {
    const col = this.db.collection('webhook_idempotency_gmail');
    const id = sanitizeId(`${emailAddress}:${historyId}`);
    try {
      await col.doc(id).create({ createdAt: Date.now(), emailAddress, historyId } as any);
      return false;
    } catch (e: any) {
      if (isAlreadyExists(e)) return true;
      this.logger.warn('Gmail history idempotency create failed', { error: e?.message || String(e) });
      throw e;
    }
  }

  /**
   * Mark Calendar channel message-number as processed.
   */
  async markCalendarMessageProcessed(channelId: string, messageNumber: string): Promise<boolean> {
    const col = this.db.collection('webhook_idempotency_calendar');
    const id = sanitizeId(`${channelId}:${messageNumber}`);
    try {
      await col.doc(id).create({ createdAt: Date.now(), channelId, messageNumber } as any);
      return false;
    } catch (e: any) {
      if (isAlreadyExists(e)) return true;
      this.logger.warn('Calendar idempotency create failed', { error: e?.message || String(e) });
      throw e;
    }
  }

  /**
   * Record webhook processing failure for compensation.
   */
  async recordFailure(kind: 'gmail_push'|'calendar_watch', payload: any, error: string): Promise<void> {
    try {
      await this.db.collection('webhook_failures').add({
        createdAt: Date.now(),
        kind,
        error,
        payload: slimPayload(payload)
      } as any);
    } catch (e) {
      this.logger.warn('Failed to record webhook failure', { error: (e as any)?.message || String(e) });
    }
  }
}

function isAlreadyExists(e: any): boolean {
  // @google-cloud/firestore throws 6 ALREADY_EXISTS code; fallback to message check
  const code = e?.code || e?.status;
  return code === 6 || String(e?.message || '').toLowerCase().includes('already exists');
}

function sanitizeId(id: string): string {
  // Firestore doc id safe simple sanitizer
  return id.replace(/[\n\r\t\s/\\#?%*:\[\]]+/g, '_').slice(0, 150);
}

function slimPayload(payload: any): any {
  try {
    const json = JSON.stringify(payload);
    if (json.length <= 40_000) return payload;
    return { note: 'truncated', length: json.length };
  } catch {
    return { note: 'unserializable' };
  }
}

