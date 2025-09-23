import { google } from 'googleapis';
import { Firestore } from '@google-cloud/firestore';

type WeightRow = Record<string, any> & { feature_hash?: string; weight?: number; score?: number };

export class PolicyWeightsService {
  private static instance: PolicyWeightsService | null = null;
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private ttlMs = Number(process.env.POLICY_CACHE_TTL_SECONDS || 60) * 1000;
  private l2TtlMs = Number(process.env.POLICY_CACHE_L2_TTL_SECONDS || 90) * 1000;

  static getInstance(): PolicyWeightsService {
    if (!this.instance) this.instance = new PolicyWeightsService();
    return this.instance;
  }

  async getPolicyForTenant(tenantId: string): Promise<any> {
    const key = `tenant:${tenantId}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) return hit.data;

    const l2 = await this.readL2(tenantId).catch(() => null);
    if (l2) {
      this.cache.set(key, { data: l2, expires: now + this.ttlMs });
      return l2;
    }

    const data = await this.loadFromBigQuery(tenantId);
    this.cache.set(key, { data, expires: now + this.ttlMs });
    await this.writeL2(tenantId, data).catch(() => {});
    return data;
  }

  private async loadFromBigQuery(tenantId: string): Promise<any> {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'smartmeet-470807';
    const dataset = process.env.BIGQUERY_DATASET_POLICY || 'smartmeet_meetings';
    const auth = await google.auth.getClient({ scopes: ['https://www.googleapis.com/auth/bigquery'] });
    const bq = google.bigquery('v2');

    const versionQuery = `
      WITH rollout AS (
        SELECT stable_version FROM \`${projectId}.${dataset}.policy_rollout\`
        WHERE tenant_id = @tenant
        ORDER BY updated_at DESC LIMIT 1
      ), latest AS (
        SELECT MAX(policy_version) AS v FROM \`${projectId}.${dataset}.policy_weights\`
        WHERE tenant_id = @tenant
      )
      SELECT COALESCE((SELECT stable_version FROM rollout), (SELECT v FROM latest)) AS policy_version
    `;

    const vResp: any = await bq.jobs.query({
      projectId,
      auth,
      requestBody: {
        query: versionQuery,
        useLegacySql: false,
        parameterMode: 'NAMED',
        queryParameters: [{ name: 'tenant', parameterType: { type: 'STRING' }, parameterValue: { value: tenantId } }]
      }
    });
    const vRows = vResp.data?.rows || [];
    const version = vRows[0]?.f?.[0]?.v || '';

    if (!version) return { version: '', weights: [] };

    const weightsQuery = `
      SELECT * FROM \`${projectId}.${dataset}.policy_weights\`
      WHERE tenant_id = @tenant AND policy_version = @version
    `;
    const wResp: any = await bq.jobs.query({
      projectId,
      auth,
      requestBody: {
        query: weightsQuery,
        useLegacySql: false,
        parameterMode: 'NAMED',
        queryParameters: [
          { name: 'tenant', parameterType: { type: 'STRING' }, parameterValue: { value: tenantId } },
          { name: 'version', parameterType: { type: 'STRING' }, parameterValue: { value: version } }
        ]
      }
    });
    const rows: any[] = this.rowsToObjects(wResp.data);
    return { version, weights: rows };
  }

  private rowsToObjects(data: any): any[] {
    const schema = data?.schema?.fields || [];
    const rows = data?.rows || [];
    return rows.map((r: any) => {
      const obj: any = {};
      r.f.forEach((c: any, i: number) => { obj[schema[i].name] = c.v; });
      return obj as WeightRow;
    });
  }

  private async readL2(tenantId: string): Promise<any | null> {
    const db = new Firestore();
    const doc = await db.collection('policy_cache').doc(`tenant:${tenantId}`).get();
    if (!doc.exists) return null;
    const d = doc.data() as any;
    if (!d || typeof d !== 'object') return null;
    if (typeof d.expires === 'number' && d.expires < Date.now()) return null;
    return d.data || null;
  }

  private async writeL2(tenantId: string, data: any): Promise<void> {
    const db = new Firestore();
    await db.collection('policy_cache').doc(`tenant:${tenantId}`).set({
      data,
      expires: Date.now() + this.l2TtlMs,
      updatedAt: Date.now()
    }, { merge: true });
  }
}

