import { Firestore, FieldValue } from '@google-cloud/firestore';
import { Logger } from '../utils/Logger.js';

export type QueueItem = {
  id: string;
  type: string;
  status: 'pending'|'leased'|'done'|'failed';
  payload: any;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  leaseUntil?: number;
  dedupKey?: string;
};

export class EventQueueService {
  private db: Firestore;
  private logger: Logger;
  private colName = 'event_queue';

  constructor() {
    this.db = new Firestore();
    this.logger = new Logger('EventQueueService');
  }

  async enqueue(type: string, payload: any, dedupKey?: string): Promise<string> {
    // optional dedup using deterministic document id
    if (dedupKey) {
      const id = this.sanitizeId(`${type}:${dedupKey}`);
      try {
        await this.db.collection(this.colName).doc(id).create({
          type,
          status: 'pending',
          payload,
          attempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          dedupKey
        } as any);
        return id;
      } catch (e: any) {
        if (this.isAlreadyExists(e)) return id; // dedup hit
        throw e;
      }
    }
    const ref = await this.db.collection(this.colName).add({
      type,
      status: 'pending',
      payload,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dedupKey: dedupKey || null
    } as any);
    return ref.id;
  }

  async leaseNext(max: number = 5, leaseMs: number = 60000): Promise<QueueItem[]> {
    const now = Date.now();
    const q = await this.db.collection(this.colName)
      .where('status', '==', 'pending')
      .limit(max)
      .get();
    const items: QueueItem[] = [];
    for (const doc of q.docs) {
      const id = doc.id;
      const data = doc.data() as any;
      try {
        await doc.ref.update({
          status: 'leased',
          leaseUntil: now + leaseMs,
          updatedAt: now
        });
        items.push({ id, ...(data as any) });
      } catch {}
    }
    return items;
  }

  async markDone(id: string): Promise<void> {
    await this.db.collection(this.colName).doc(id).update({ status: 'done', updatedAt: Date.now(), leaseUntil: FieldValue.delete() });
  }

  async markFailed(id: string, error?: string): Promise<void> {
    const ref = this.db.collection(this.colName).doc(id);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const attempts = (snap.data() as any)?.attempts || 0;
      tx.update(ref, { status: 'failed', attempts: attempts + 1, error: error || null, updatedAt: Date.now(), leaseUntil: FieldValue.delete() });
    });
  }

  private sanitizeId(id: string): string { return id.replace(/[\n\r\t\s/\\#?%*:\[\]]+/g, '_').slice(0, 150); }
  private isAlreadyExists(e: any): boolean { const code = e?.code || e?.status; return code === 6 || String(e?.message || '').toLowerCase().includes('already exists'); }
}
