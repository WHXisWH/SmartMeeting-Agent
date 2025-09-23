import { google } from 'googleapis';
import { Logger } from '../utils/Logger.js';
import { GoogleWorkspaceService } from './GoogleWorkspaceService.js';

interface MaterialCandidate {
  id: string;
  name: string;
  webViewLink: string;
  mimeType: string;
  modifiedTime: string;
  score: number;
  matchReasons: string[];
}

interface SearchContext {
  subject: string;
  fromDomain?: string;
  participantEmails?: string[];
  eventTimestamp?: number;
}

/**
 * Enhanced material linking service with multi-criteria search strategy
 */
export class MaterialLinkingService {
  private logger = new Logger('MaterialLinkingService');
  private workspaceService: GoogleWorkspaceService;

  constructor() {
    this.workspaceService = new GoogleWorkspaceService();
  }

  /**
   * Find and rank related materials using multi-criteria strategy
   */
  async findRelatedMaterials(
    context: SearchContext,
    maxResults: number = 5
  ): Promise<MaterialCandidate[]> {
    try {
      // Access auth through the private property without calling ensureAuth
      const auth = (this.workspaceService as any).auth;
      const drive = google.drive({ version: 'v3', auth });

      // Strategy 1: Subject n-gram analysis
      const subjectCandidates = await this.searchBySubjectNgrams(drive, context.subject);

      // Strategy 2: Sender domain-based search
      const domainCandidates = context.fromDomain
        ? await this.searchBySenderDomain(drive, context.fromDomain)
        : [];

      // Strategy 3: Recent access heat-based search (90-day window)
      const recentCandidates = await this.searchByRecentAccess(drive, context.eventTimestamp);

      // Strategy 4: MIME priority-based filtering
      const allCandidates = this.deduplicateAndMerge([
        ...subjectCandidates,
        ...domainCandidates,
        ...recentCandidates
      ]);

      // Apply MIME type prioritization and final scoring
      const rankedCandidates = this.applyMimePriorityAndRank(allCandidates, context);

      return rankedCandidates.slice(0, maxResults);
    } catch (error) {
      this.logger.error('Failed to find related materials', error);
      return [];
    }
  }

  /**
   * Strategy 1: Subject n-gram analysis for file name and content matching
   */
  private async searchBySubjectNgrams(
    drive: any,
    subject: string
  ): Promise<MaterialCandidate[]> {
    const candidates: MaterialCandidate[] = [];

    // Extract meaningful tokens (2-4 characters, excluding common words)
    const tokens = this.extractMeaningfulTokens(subject);
    const nGrams = this.generateNGrams(tokens, 2, 3);

    for (const gram of nGrams.slice(0, 10)) { // Limit to prevent too many queries
      try {
        const query = this.buildNGramQuery(gram);
        const response = await drive.files.list({
          q: query,
          pageSize: 10,
          fields: 'files(id,name,webViewLink,mimeType,modifiedTime,viewedByMeTime)',
          orderBy: 'modifiedTime desc'
        });

        for (const file of response.data.files || []) {
          const score = this.calculateSubjectMatchScore(gram, file.name || '', subject);
          candidates.push({
            id: file.id!,
            name: file.name || 'Untitled',
            webViewLink: file.webViewLink!,
            mimeType: file.mimeType || 'application/octet-stream',
            modifiedTime: file.modifiedTime!,
            score,
            matchReasons: [`Subject n-gram: "${gram.join(' ')}"`]
          });
        }
      } catch (error) {
        this.logger.debug(`N-gram search failed for: ${gram.join(' ')}`, error);
      }
    }

    return candidates;
  }

  /**
   * Strategy 2: Sender domain-based material discovery
   */
  private async searchBySenderDomain(
    drive: any,
    domain: string
  ): Promise<MaterialCandidate[]> {
    const candidates: MaterialCandidate[] = [];

    try {
      // Search for files shared by or containing the sender domain
      const domainQuery = `"${domain}" and modifiedTime > '${this.get90DaysAgo()}' and trashed=false`;

      const response = await drive.files.list({
        q: domainQuery,
        pageSize: 15,
        fields: 'files(id,name,webViewLink,mimeType,modifiedTime,sharingUser,owners)',
        orderBy: 'modifiedTime desc'
      });

      for (const file of response.data.files || []) {
        const score = this.calculateDomainMatchScore(domain, file);
        candidates.push({
          id: file.id!,
          name: file.name || 'Untitled',
          webViewLink: file.webViewLink!,
          mimeType: file.mimeType || 'application/octet-stream',
          modifiedTime: file.modifiedTime!,
          score,
          matchReasons: [`Sender domain: ${domain}`]
        });
      }
    } catch (error) {
      this.logger.debug(`Domain search failed for: ${domain}`, error);
    }

    return candidates;
  }

  /**
   * Strategy 3: Recent access heat-based search (90-day popularity)
   */
  private async searchByRecentAccess(
    drive: any,
    eventTimestamp?: number
  ): Promise<MaterialCandidate[]> {
    const candidates: MaterialCandidate[] = [];

    try {
      // Focus on recently accessed and modified files
      const recentQuery = `modifiedTime > '${this.get90DaysAgo()}' and trashed=false`;

      const response = await drive.files.list({
        q: recentQuery,
        pageSize: 20,
        fields: 'files(id,name,webViewLink,mimeType,modifiedTime,viewedByMeTime,version)',
        orderBy: 'viewedByMeTime desc'
      });

      for (const file of response.data.files || []) {
        const score = this.calculateAccessHeatScore(file, eventTimestamp);
        if (score > 0.1) { // Only include files with meaningful access patterns
          candidates.push({
            id: file.id!,
            name: file.name || 'Untitled',
            webViewLink: file.webViewLink!,
            mimeType: file.mimeType || 'application/octet-stream',
            modifiedTime: file.modifiedTime!,
            score,
            matchReasons: ['Recent access pattern']
          });
        }
      }
    } catch (error) {
      this.logger.debug('Recent access search failed', error);
    }

    return candidates;
  }

  /**
   * Deduplicate and merge candidates from different strategies
   */
  private deduplicateAndMerge(candidates: MaterialCandidate[]): MaterialCandidate[] {
    const seen = new Map<string, MaterialCandidate>();

    for (const candidate of candidates) {
      const existing = seen.get(candidate.id);
      if (existing) {
        // Merge scores and reasons
        existing.score = Math.max(existing.score, candidate.score);
        existing.matchReasons = [...new Set([...existing.matchReasons, ...candidate.matchReasons])];
      } else {
        seen.set(candidate.id, { ...candidate });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Strategy 4: Apply MIME type prioritization and final ranking
   */
  private applyMimePriorityAndRank(
    candidates: MaterialCandidate[],
    context: SearchContext
  ): MaterialCandidate[] {
    const mimePriority = this.getMimePriorityMap();

    return candidates
      .map(candidate => ({
        ...candidate,
        score: candidate.score * (mimePriority.get(candidate.mimeType) || 1.0)
      }))
      .sort((a, b) => {
        // Primary sort by score, secondary by modification time
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
        return new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
      });
  }

  /**
   * Extract meaningful tokens from subject, filtering common words
   */
  private extractMeaningfulTokens(subject: string): string[] {
    const commonWords = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'meeting', 'mtg', 'call', 'discussion', 'sync', 'review', 'update',
      'について', 'に関して', 'の件', 'について', 'ミーティング', '会議', '打ち合わせ'
    ]);

    return subject
      .split(/[^A-Za-z0-9_\u3040-\u30FF\u4E00-\u9FAF]+/)
      .filter(token =>
        token &&
        token.length >= 2 &&
        token.length <= 20 &&
        !commonWords.has(token.toLowerCase())
      )
      .slice(0, 8); // Limit to most important tokens
  }

  /**
   * Generate n-grams from tokens
   */
  private generateNGrams(tokens: string[], minN: number, maxN: number): string[][] {
    const nGrams: string[][] = [];

    for (let n = minN; n <= maxN; n++) {
      for (let i = 0; i <= tokens.length - n; i++) {
        nGrams.push(tokens.slice(i, i + n));
      }
    }

    return nGrams.sort((a, b) => b.length - a.length); // Prefer longer n-grams
  }

  /**
   * Build Drive API query for n-gram search
   */
  private buildNGramQuery(nGram: string[]): string {
    const escaped = nGram.map(token => token.replace(/'/g, "\\'"));
    const nameQuery = escaped.map(token => `name contains '${token}'`).join(' and ');
    const contentQuery = escaped.map(token => `fullText contains '${token}'`).join(' and ');
    const dateFilter = `modifiedTime > '${this.get90DaysAgo()}'`;

    return `(${nameQuery} or ${contentQuery}) and ${dateFilter} and trashed=false`;
  }

  /**
   * Calculate subject match score based on n-gram overlap
   */
  private calculateSubjectMatchScore(nGram: string[], fileName: string, subject: string): number {
    let score = 0.5; // Base score for any match

    // Boost for exact phrase matches
    const phrase = nGram.join(' ').toLowerCase();
    if (fileName.toLowerCase().includes(phrase)) {
      score += 0.3;
    }

    // Boost for individual token matches
    const matchCount = nGram.filter(token =>
      fileName.toLowerCase().includes(token.toLowerCase())
    ).length;
    score += (matchCount / nGram.length) * 0.2;

    return Math.min(1.0, score);
  }

  /**
   * Calculate domain match score
   */
  private calculateDomainMatchScore(domain: string, file: any): number {
    let score = 0.4; // Base score for domain association

    // Check if file was shared by domain user
    const owners = file.owners || [];
    const sharingUser = file.sharingUser;

    if (owners.some((owner: any) => owner.emailAddress?.includes(domain))) {
      score += 0.3;
    }

    if (sharingUser?.emailAddress?.includes(domain)) {
      score += 0.2;
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate access heat score based on recent activity
   */
  private calculateAccessHeatScore(file: any, eventTimestamp?: number): number {
    const now = Date.now();
    const modifiedTime = new Date(file.modifiedTime).getTime();
    const viewedTime = file.viewedByMeTime ? new Date(file.viewedByMeTime).getTime() : 0;

    let score = 0.3; // Base score

    // Boost for recent modifications (within 30 days)
    const daysSinceModified = (now - modifiedTime) / (24 * 60 * 60 * 1000);
    if (daysSinceModified <= 30) {
      score += 0.3 * (1 - daysSinceModified / 30);
    }

    // Boost for recent views
    if (viewedTime > 0) {
      const daysSinceViewed = (now - viewedTime) / (24 * 60 * 60 * 1000);
      if (daysSinceViewed <= 14) {
        score += 0.2 * (1 - daysSinceViewed / 14);
      }
    }

    // Boost if file was modified close to event time
    if (eventTimestamp) {
      const hoursFromEvent = Math.abs(modifiedTime - eventTimestamp) / (60 * 60 * 1000);
      if (hoursFromEvent <= 72) {
        score += 0.2 * (1 - hoursFromEvent / 72);
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Get MIME type priority mapping for business relevance
   */
  private getMimePriorityMap(): Map<string, number> {
    return new Map([
      // High priority: Documents and presentations
      ['application/vnd.google-apps.document', 1.3],
      ['application/vnd.google-apps.presentation', 1.3],
      ['application/vnd.google-apps.spreadsheet', 1.2],
      ['application/pdf', 1.2],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1.2],
      ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 1.2],

      // Medium priority: Data and forms
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1.1],
      ['application/vnd.google-apps.form', 1.1],
      ['text/plain', 1.0],

      // Lower priority: Media and archives
      ['image/jpeg', 0.8],
      ['image/png', 0.8],
      ['application/zip', 0.7],
      ['video/mp4', 0.6],

      // Lowest priority: Folders and shortcuts
      ['application/vnd.google-apps.folder', 0.3],
      ['application/vnd.google-apps.shortcut', 0.5],
    ]);
  }

  /**
   * Get 90-day cutoff date for recency filtering
   */
  private get90DaysAgo(): string {
    return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  }

  /**
   * Prepare material candidates for event attachment with file IDs
   */
  async prepareMaterialsForEvent(
    candidates: MaterialCandidate[]
  ): Promise<Array<{ id: string; fileUrl: string; title: string; mimeType: string; matchReasons: string[] }>> {
    return candidates.map(candidate => ({
      id: candidate.id,
      fileUrl: candidate.webViewLink,
      title: candidate.name,
      mimeType: candidate.mimeType,
      matchReasons: candidate.matchReasons
    }));
  }
}