import { Firestore, FieldValue } from '@google-cloud/firestore';
import { Logger } from '../utils/Logger.js';
import type { AgentContext, Decision } from '../types/index.js';
import type { PolicyParams } from '../learning/PolicyStore.js';
import type { Memory } from '../memory/MemorySystem.js';

/**
 * @class FirestoreService
 * @description Handles all interactions with the Google Cloud Firestore database.
 */
export class FirestoreService {
  private db: Firestore;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('FirestoreService');
    try {
      this.db = new Firestore({ ignoreUndefinedProperties: true } as any);
      this.logger.info('Firestore client initialized successfully.');
    } catch (error) {
      this.logger.error('Failed to initialize Firestore client', error);
      throw new Error('Could not connect to Firestore. Ensure your environment is configured correctly.');
    }
  }

  /**
   * Adds a new activity log entry to the database.
   * @param log - The log object to add.
   */
  async addActivityLog(log: { timestamp: Date; message: string; data?: any }): Promise<string> {
    const docRef = await this.db.collection('activityLogs').add({
      ...log,
      serverTimestamp: FieldValue.serverTimestamp(), // Use server-side timestamp for ordering
    });
    return docRef.id;
  }

  /**
   * Retrieves the latest activity logs.
   * @param limit - The number of logs to retrieve.
   * @returns A promise that resolves to an array of log entries.
   */
  async getActivityLog(limit: number = 50): Promise<any[]> {
    const snapshot = await this.db.collection('activityLogs').orderBy('serverTimestamp', 'desc').limit(limit).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Adds a new decision to the database.
   * @param decision - The decision object to add.
   */
  async addDecision(decision: Decision): Promise<string> {
    const docRef = await this.db.collection('decisions').add({
        ...decision,
        serverTimestamp: FieldValue.serverTimestamp(),
    });
    return docRef.id;
  }

  /**
   * Retrieves the latest decision from the database.
   * @returns A promise that resolves to the latest decision object or null.
   */
  async getLatestDecision(): Promise<Decision | null> {
    const snapshot = await this.db.collection('decisions').orderBy('serverTimestamp', 'desc').limit(1).get();
    if (snapshot.empty) {
      return null;
    }
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as Decision;
  }

  // --- Policy persistence ---
  async savePolicyVersion(policy: PolicyParams, notes: string = 'offline_training', metadata?: any): Promise<string> {
    const ref = await this.db.collection('agent_policies').add({
      createdAt: FieldValue.serverTimestamp(),
      notes,
      policy,
      metadata: metadata || {}
    } as any);
    return ref.id;
  }

  async getLatestPolicy(): Promise<PolicyParams | null> {
    const snap = await this.db.collection('agent_policies').orderBy('createdAt', 'desc').limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0].data() as any;
    return (doc?.policy || null) as PolicyParams | null;
  }

  async getPolicyHistory(limit: number = 20): Promise<any[]> {
    const snap = await this.db.collection('agent_policies').orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // --- Knowledge persistence (semantic/procedural) ---
  private collectionFor(type: 'semantic'|'procedural') {
    return type === 'semantic' ? 'knowledge_semantic' : 'knowledge_procedural';
  }

  async saveKnowledgeDraft(
    type: 'semantic'|'procedural',
    memories: Memory[],
    meta?: { runner?: string; source?: string }
  ): Promise<string[]> {
    const col = this.collectionFor(type);
    const batch = this.db.batch();
    const ids: string[] = [];
    memories.forEach(m => {
      const ref = this.db.collection(col).doc();
      ids.push(ref.id);
      batch.set(ref, {
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        approved: false,
        runner: meta?.runner || null,
        source: meta?.source || 'training_pipeline',
        memory: m
      } as any);
    });
    await batch.commit();
    return ids;
  }

  async listKnowledge(
    type: 'semantic'|'procedural',
    opts: { approved?: boolean; limit?: number } = {}
  ): Promise<any[]> {
    const col = this.collectionFor(type);
    let q: FirebaseFirestore.Query = this.db.collection(col);
    if (typeof opts.approved === 'boolean') q = q.where('approved', '==', opts.approved);
    if (opts.limit) q = q.limit(opts.limit);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  }

  async approveKnowledge(
    type: 'semantic'|'procedural',
    id: string,
    approver: string
  ): Promise<void> {
    const col = this.collectionFor(type);
    await this.db.collection(col).doc(id).update({
      approved: true,
      approvedBy: approver,
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  async getApprovedKnowledge(type: 'semantic'|'procedural', limit: number = 1000): Promise<Memory[]> {
    const col = this.collectionFor(type);
    const snap = await this.db.collection(col)
      .where('approved', '==', true)
      .limit(limit)
      .get();
    return snap.docs.map(d => (d.data() as any).memory as Memory);
  }
}
