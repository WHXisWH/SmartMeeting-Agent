import { Logger } from '../utils/Logger.js';
import { ToolRegistry, BaseTool } from '../tools/ToolInterface.js';
import { CalendarTool } from '../tools/CalendarTool.js';
import { GmailTool } from '../tools/GmailTool.js';
import { DriveTool } from '../tools/DriveTool.js';
import { DecisionTool } from '../tools/DecisionTool.js';

export interface AgentBuilderResponse {
  status: 'reachable' | 'unreachable' | 'error';
  message: string;
  timestamp: string;
  response?: any;
  error?: string;
}

export interface AgentConversationRequest {
  message: string;
  context?: any;
  sessionId?: string;
  tools?: string[];
}

export interface AgentConversationResponse {
  response: string;
  confidence: number;
  sessionId: string;
  toolsUsed?: Array<{
    toolName: string;
    parameters: any;
    result: any;
  }>;
  reasoning?: string;
}

export class VertexAgentService {
  private logger: Logger;
  private projectId: string;
  private location: string;
  private isInitialized: boolean = false;
  private toolRegistry: ToolRegistry;
  private availableTools: BaseTool[] = [];
  private sessionHistory: Map<string, Array<{ role: string; parts: Array<{ text: string }> }>> = new Map();
  private sessionLang: Map<string, string> = new Map();

  constructor() {
    this.logger = new Logger('VertexAgentService');
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 'smartmeet-470807';
    this.location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
    this.toolRegistry = ToolRegistry.getInstance();
  }

  private initializing: Promise<void> | null = null;

  private async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (!this.initializing) {
      this.initializing = this.initialize().catch(err => {
        this.initializing = null;
        throw err;
      });
    }
    return this.initializing;
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing Vertex AI Agent Builder service...');
    
    try {
      if (!this.projectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT_ID is not configured');
      }

      await this.initializeTools();

      const vx: any = await import('@google-cloud/vertexai').catch(() => null);
      if (!vx) throw new Error('Vertex AI SDK (@google-cloud/vertexai) not installed');
      const { VertexAI } = vx;
      const client = new VertexAI({ project: this.projectId, location: this.location });
      client.getGenerativeModel({ model: process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro' });

      await this.registerTools();

      this.isInitialized = true;
      this.logger.info('Vertex AI Agent service initialized', {
        toolsRegistered: this.availableTools.length,
        tools: this.availableTools.map(t => t.getDefinition().name)
      });

    } catch (error) {
      this.logger.error('Failed to initialize Vertex AI Agent Builder service', error);
      throw error;
    }
  }

  private async initializeTools(): Promise<void> {
    this.logger.info('Initializing tools for Agent Builder...');

    this.availableTools = [
      new CalendarTool(),
      new GmailTool(),
      new DriveTool(),
      new DecisionTool()
    ];

    for (const tool of this.availableTools) {
      this.toolRegistry.register(tool);
    }

    const initResult = await this.toolRegistry.initializeAll();
    
    if (!initResult.success) {
      this.logger.warn('Some tools failed to initialize:', initResult.errors);
    }

    this.logger.info('Tools initialization completed', {
      totalTools: this.availableTools.length,
      errors: initResult.errors.length
    });
  }

  private async registerTools(): Promise<void> {
    this.logger.info('Registering tools with Agent Builder...');

    const toolDefinitions = this.toolRegistry.getAllDefinitions();
    
    this.logger.info('Tools registered with Agent Builder', {
      tools: toolDefinitions.map(def => ({
        name: def.name,
        category: def.category,
        parameterCount: def.parameters.length
      }))
    });
  }

  async pingAgentBuilder(): Promise<AgentBuilderResponse> {
    const timestamp = new Date().toISOString();
    
    await this.ensureInitialized().catch(() => {});

    try {
      this.logger.info('Pinging Vertex AI (model init) ...');
      const vx: any = await import('@google-cloud/vertexai').catch(() => null);
      if (!vx) throw new Error('Vertex AI SDK not available');
      const { VertexAI } = vx;
      const client = new VertexAI({ project: this.projectId, location: this.location });
      const model = client.getGenerativeModel({ model: process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro' });

      if (!model) throw new Error('Failed to construct GenerativeModel');
      return { status: 'reachable', message: 'Vertex model available', timestamp, response: { projectId: this.projectId, location: this.location } };

    } catch (error) {
      this.logger.error('Failed to ping Agent Builder', error);
      
      return {
        status: 'error',
        message: 'Failed to reach Vertex AI Agent Builder',
        timestamp,
        error: (error as Error).message
      };
    }
  }

  async testAgentBuilderCall(prompt: string = "Hello, this is a connectivity test"): Promise<AgentBuilderResponse> {
    const timestamp = new Date().toISOString();
    
    await this.ensureInitialized();

    try {
      this.logger.info('Testing Vertex AI call with prompt', { prompt });
      const vx: any = await import('@google-cloud/vertexai').catch(() => null);
      if (!vx) throw new Error('Vertex AI SDK not available');
      const { VertexAI } = vx;
      const client = new VertexAI({ project: this.projectId, location: this.location });
      const model = client.getGenerativeModel({ model: process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro' });
      const resp = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
      const text = resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const output = { response: text || '(empty)', confidence: 0.5, sessionId: `test-${Date.now()}`, model: process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro' };
      this.logger.info('Vertex call successful');
      return { status: 'reachable', message: 'Vertex responded to test prompt', timestamp, response: output };

    } catch (error) {
      this.logger.error('Agent Builder call failed', error);
      
      return {
        status: 'error',
        message: 'Agent Builder failed to respond to test prompt',
        timestamp,
        error: (error as Error).message
      };
    }
  }


  async chat(request: AgentConversationRequest): Promise<AgentConversationResponse> {
    await this.ensureInitialized();

    this.logger.info('Processing Agent Builder conversation', {
      message: request.message,
      sessionId: request.sessionId,
      requestedTools: request.tools
    });

    try {
      const sid = request.sessionId || `session_${Date.now()}`;
      request.sessionId = sid;
      this.updatePreferredLanguageFromMessage(sid, request.message, request.context);
      const viaGen = await this.chatViaGenerativeModel(request);
      if (!viaGen) {
        const toolsUsed: any[] = [];
        const required = request.tools && request.tools.length > 0 ? request.tools : this.analyzeMessageForToolsV2(request.message);
        for (const t of required) {
          const exec = await this.executeToolForMessage(t, request.message, request.context).catch(()=>null);
          if (exec) toolsUsed.push(exec);
        }
        const hybrid = this.generateResponseV2(request.message, toolsUsed, request.context);
        this.appendHistory(sid, 'user', request.message);
        this.appendHistory(sid, 'model', hybrid.text);
        return {
          response: hybrid.text,
          confidence: toolsUsed.length > 0 ? 0.75 : 0.5,
          sessionId: sid,
          toolsUsed,
          reasoning: 'Vertex unavailable; returned tool-only result.'
        };
      }

      
      if (!viaGen.toolsUsed || viaGen.toolsUsed.length === 0) {
        const toolsUsed: any[] = [];
        const required = request.tools && request.tools.length > 0 ? request.tools : this.analyzeMessageForToolsV2(request.message);
        for (const t of required) {
          const exec = await this.executeToolForMessage(t, request.message, request.context).catch(()=>null);
          if (exec) toolsUsed.push(exec);
        }
        if (toolsUsed.length > 0) {
          const hybrid = this.generateResponseV2(request.message, toolsUsed, request.context);
          return {
            response: hybrid.text,
            confidence: Math.max(0.8, viaGen.confidence || 0.7),
            sessionId: viaGen.sessionId,
            toolsUsed: toolsUsed,
            reasoning: (viaGen.reasoning ? viaGen.reasoning + '\n' : '') + 'Note: Related tools were executed automatically.'
          };
        }
      }
      return viaGen;
    } catch (error) {
      this.logger.error('Agent conversation failed (no fallback)', error);
      throw error;
    }
  }


  private async chatViaGenerativeModel(request: AgentConversationRequest): Promise<AgentConversationResponse | null> {
    try {
      const vx: any = await import('@google-cloud/vertexai').catch(() => null);
      if (!vx) return null;

      const { VertexAI } = vx;
      const project = process.env.GOOGLE_CLOUD_PROJECT_ID;
      const location = process.env.VERTEX_AI_LOCATION || 'asia-northeast1';
      const modelName = process.env.VERTEX_AI_MODEL || 'gemini-1.5-pro';
      const client = new VertexAI({ project, location });

      const toolDecls = this.toolRegistry.getAllDefinitions().map(def => ({
        name: def.name,
        description: def.description,
        parameters: {
          type: 'OBJECT',
          properties: Object.fromEntries(def.parameters.map(p => [p.name, { type: this.mapParamType(p.type), description: p.description }])),
          required: def.parameters.filter(p => p.required).map(p => p.name)
        }
      }));

      const prefLang = this.getPreferredLanguage(request.sessionId || '', request.context, request.message);
      const model = client.getGenerativeModel({
        model: modelName,
        tools: [{ functionDeclarations: toolDecls }],
        systemInstruction: {
          role: 'system',
          parts: [{ text: this.getToolUsageInstruction(prefLang) }]
        }
      } as any);

      const sessionId = request.sessionId || `session_${Date.now()}`;
      const history = this.sessionHistory.get(sessionId) || [];
      const chat = model.startChat({ history } as any);

      this.appendHistory(sessionId, 'user', request.message);
      const first = await chat.sendMessage([{ text: request.message }] as any);
      const msg = first?.response;

      const calls: any[] = this.extractFunctionCalls(msg);
      const toolsUsed: any[] = [];

      for (const c of calls) {
        const toolName = c?.name || c?.functionName || c?.id || 'unknown';
        const parameters = c?.args || c?.parameters || {};
        const fixed = this.normalizeToolParameters(toolName, parameters);
        const exec = await this.toolRegistry.executeTool(toolName, fixed).catch((e: any) => ({ success: false, error: e?.message || String(e) }));
        toolsUsed.push({ toolName, parameters, result: exec });
        await chat.sendMessage([
          { functionResponse: { name: toolName, response: exec } }
        ] as any);
      }

      const finalResp = calls.length > 0 ? await chat.sendMessage([{ text: 'Return the final answer based on the tool results.' }] as any) : first;
      const text = finalResp?.response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('\n') || 'Done.';
      this.appendHistory(sessionId, 'model', text);

      return {
        response: text,
        confidence: 0.85,
        sessionId,
        toolsUsed,
        reasoning: 'Answer is based on Vertex AI function calls and registered tool results.'
      };
    } catch (e) {
      this.logger.warn('chatViaGenerativeModel fallback due to error', e);
      return null;
    }
  }

    private getToolUsageInstruction(lang?: string): string {
    const langLine = lang === 'ja'
      ? 'Use Japanese for responses when the user message is in Japanese.'
      : 'Use English for responses unless the user message is in Japanese.';
    return `SmartMeet Agent. Always call tools first to get facts, then answer.
${langLine}
calendar_manager: use for meetings/schedules/calendars/conflicts.
gmail_manager: use for sending notifications/emails.
drive_manager: use for creating documents/agendas/minutes/files.
decision_engine: use for suggestions/optimization/recommendations.
Include parameter 'action' for each tool.`;
  }

  private mapParamType(t: string): string {
    switch (t) {
      case 'string': return 'STRING';
      case 'number': return 'NUMBER';
      case 'boolean': return 'BOOLEAN';
      case 'array': return 'ARRAY';
      case 'object':
      default: return 'OBJECT';
    }
  }

  private extractFunctionCalls(resp: any): any[] {
    try {
      const parts = resp?.candidates?.[0]?.content?.parts || [];
      const calls = parts.flatMap((p: any) => (p.functionCalls || p.functionCall ? [p.functionCalls || p.functionCall] : [])).flat();
      return Array.isArray(calls) ? calls : (calls ? [calls] : []);
    } catch {
      return [];
    }
  }

  private normalizeToolParameters(toolName: string, parameters: any): any {
    const p = { ...(parameters || {}) };
    const map = (v: any, pairs: Array<[string, string]>) => {
      const val = String(v || '').toLowerCase();
      for (const [k, to] of pairs) { if (val === k) return to; }
      return v;
    };
    if (!p.action) {
      if (toolName === 'calendar_manager') p.action = 'get_events';
      if (toolName === 'gmail_manager') p.action = 'send_email';
      if (toolName === 'drive_manager') p.action = 'create_document';
      if (toolName === 'decision_engine') p.action = 'suggest_optimization';
    }
    if (toolName === 'calendar_manager') {
      p.action = map(p.action, [['list_events','get_events'],['list','get_events'],['fetch_events','get_events'],['create_event','create_meeting'],['update_event','update_meeting'],['cancel_event','cancel_meeting']]);
    }
    if (toolName === 'gmail_manager') {
      p.action = map(p.action, [['send','send_email'],['notify','send_email']]);
    }
    if (toolName === 'drive_manager') {
      p.action = map(p.action, [['create_doc','create_document'],['new_doc','create_document']]);
    }
    if (toolName === 'decision_engine') {
      p.action = map(p.action, [['suggest','suggest_optimization'],['recommend','suggest_optimization']]);
    }
    return p;
  }

  private analyzeMessageForTools(message: string): string[] {
    const tools: string[] = [];
    const m = (message || '').toLowerCase();
    const ja = message || '';
    if (m.includes('meeting') || m.includes('calendar') || m.includes('schedule') ||
        ja.includes('予定') || ja.includes('カレンダー') || ja.includes('日程') || ja.includes('スケジュール') || ja.includes('会議') || ja.includes('打ち合わせ') || ja.includes('確認') || ja.includes('見る')) tools.push('calendar_manager');
    if (m.includes('email') || m.includes('mail') || m.includes('send') || m.includes('notify') ||
        ja.includes('メール') || ja.includes('送信') || ja.includes('通知')) tools.push('gmail_manager');
    if (m.includes('document') || m.includes('file') || m.includes('create') || m.includes('minutes') || m.includes('agenda') ||
        ja.includes('ドキュメント') || ja.includes('議事録') || ja.includes('アジェンダ') || ja.includes('ファイル') || ja.includes('作成')) tools.push('drive_manager');
    if (m.includes('conflict') || m.includes('decide') || m.includes('suggest') || m.includes('recommend') || m.includes('optimize') ||
        ja.includes('提案') || ja.includes('推奨') || ja.includes('最適化') || ja.includes('調整') || ja.includes('衝突') || ja.includes('コンフリクト')) tools.push('decision_engine');
    return tools;
  }

  private generateToolParameters(toolName: string, message: string, context?: any): Record<string, any> {
    const now = new Date();
    switch (toolName) {
      case 'calendar_manager':
        {
          const rng = this.parseRelativeRangeV2(message, context);
          return {
            action: 'get_events',
            timeMin: (rng?.start || now).toISOString(),
            timeMax: (rng?.end || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)).toISOString()
          };
        }
      case 'gmail_manager':
        return {
          action: 'send_email',
          to: context?.recipients || [],
          subject: 'Notification from SmartMeet Agent',
          body: 'This is an automated notification.'
        };
      case 'drive_manager':
        return {
          action: 'create_document',
          title: 'Meeting Document',
          content: 'Auto-generated content'
        };
      case 'decision_engine':
        return {
          action: 'suggest_optimization',
          context: context || { currentMeetings: 0 },
          goal: 'maximize_meeting_roi'
        };
      default:
        return {};
    }
  }

  private appendHistory(sessionId: string, role: 'user'|'model', text: string) {
    if (!sessionId) return;
    const arr = this.sessionHistory.get(sessionId) || [];
    arr.push({ role, parts: [{ text }] });
    this.sessionHistory.set(sessionId, arr);
  }

  private updatePreferredLanguageFromMessage(sessionId: string, message: string, context?: any) {
    const lang = this.detectLanguagePreferenceV2(message, context);
    if (lang) this.sessionLang.set(sessionId, lang);
  }

  private getPreferredLanguage(sessionId: string, context?: any, message?: string): string | undefined {
    return this.sessionLang.get(sessionId) || this.detectLanguagePreferenceV2(message || '', context);
  }

  private detectLanguagePreference(message: string, context?: any): string | undefined {
    if (context && typeof context.lang === 'string') return context.lang;
    const m = (message || '').toLowerCase();
    const ja = message || '';
    if (ja.includes('日本語')) return 'ja';
    if (m.includes('english') || ja.includes('英語')) return 'en';
    return undefined;
  }

  private parseRelativeRange(message: string, context?: any): { start: Date; end: Date } | null {
    const now = new Date();
    const m = (message || '').toLowerCase();
    const ja = message || '';
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
    const startOfWeekMon = (d: Date) => {
      const day = d.getDay();
      const diff = (day + 6) % 7;
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      s.setDate(s.getDate() - diff);
      s.setHours(0,0,0,0);
      return s;
    };
    const endOfWeekMon = (d: Date) => {
      const s = startOfWeekMon(d);
      const e = new Date(s.getTime());
      e.setDate(e.getDate() + 6);
      e.setHours(23,59,59,0);
      return e;
    };
    const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0);
    const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    if (m.includes('today') || ja.includes('今日')) return { start: startOfDay(now), end: endOfDay(now) };
    if (m.includes('tomorrow') || ja.includes('明日')) { const t = new Date(now); t.setDate(t.getDate()+1); return { start: startOfDay(t), end: endOfDay(t) }; }
    if (m.includes('yesterday') || ja.includes('昨日')) { const y = new Date(now); y.setDate(y.getDate()-1); return { start: startOfDay(y), end: endOfDay(y) }; }
    if (m.includes('this week') || ja.includes('今週')) return { start: startOfWeekMon(now), end: endOfWeekMon(now) };
    if (m.includes('next week') || ja.includes('来週')) { const n = new Date(now); n.setDate(n.getDate()+7); return { start: startOfWeekMon(n), end: endOfWeekMon(n) }; }
    if (m.includes('last week') || ja.includes('先週')) { const p = new Date(now); p.setDate(p.getDate()-7); return { start: startOfWeekMon(p), end: endOfWeekMon(p) }; }
    if (m.includes('this month') || ja.includes('今月')) return { start: startOfMonth(now), end: endOfMonth(now) };
    if (m.includes('recent') || ja.includes('最近') || ja.includes('直近')) {
      const s = new Date(now); const e = new Date(now); e.setDate(e.getDate()+7); s.setHours(0,0,0,0); e.setHours(23,59,59,0); return { start: s, end: e };
    }
    return null;
  }

  private async executeToolForMessage(toolName: string, message: string, context?: any): Promise<any> {
    try {
      const params = this.generateToolParameters(toolName, message, context);
      const exec = await this.toolRegistry.executeTool(toolName, params);
      return { toolName, parameters: params, result: exec };
    } catch (e: any) {
      return { toolName, parameters: {}, result: { success: false, error: e?.message || String(e) } };
    }
  }

  private generateResponse(message: string, toolsUsed: any[], context?: any): { text: string; confidence: number; reasoning: string } {
    const ok = toolsUsed.filter(t => t.result && t.result.success);
    const fail = toolsUsed.filter(t => !t.result || !t.result.success);
    let text = '';
    if (ok.length) {
      text += `Executed ${ok.length} tool(s): ${ok.map(t => t.toolName).join(', ')}.`;
    }
    if (fail.length) {
      text += `${text ? ' ' : ''}Some tools failed: ${fail.map(t => t.toolName).join(', ')}.`;
    }
    if (!text) text = 'No tools were executed.';
    return { text, confidence: ok.length ? 0.85 : 0.6, reasoning: 'Composed from tool execution results.' };
  }

  // V2 helpers added for improved language handling and tool routing
  private analyzeMessageForToolsV2(message: string): string[] {
    const tools: string[] = [];
    const m = (message || '').toLowerCase();
    const ja = message || '';
    const hasJa = /[\u3040-\u30FF\u4E00-\u9FAF]/.test(ja);
    if (
      m.includes('meeting') || m.includes('calendar') || m.includes('schedule') ||
      (hasJa && (ja.includes('会議') || ja.includes('ミーティング') || ja.includes('カレンダー') || ja.includes('日程') || ja.includes('予定') || ja.includes('スケジュール') || ja.includes('打ち合わせ')))
    ) tools.push('calendar_manager');
    if (
      m.includes('email') || m.includes('mail') || m.includes('send') || m.includes('notify') ||
      (hasJa && (ja.includes('メール') || ja.includes('送信') || ja.includes('通知')))
    ) tools.push('gmail_manager');
    if (
      m.includes('document') || m.includes('file') || m.includes('create') || m.includes('minutes') || m.includes('agenda') ||
      (hasJa && (ja.includes('ドキュメント') || ja.includes('議事録') || ja.includes('アジェンダ') || ja.includes('ファイル') || ja.includes('作成')))
    ) tools.push('drive_manager');
    if (
      m.includes('conflict') || m.includes('decide') || m.includes('suggest') || m.includes('recommend') || m.includes('optimize') ||
      (hasJa && (ja.includes('提案') || ja.includes('推奨') || ja.includes('最適化') || ja.includes('調整') || ja.includes('衝突') || ja.includes('コンフリクト')))
    ) tools.push('decision_engine');
    return tools;
  }

  private detectLanguagePreferenceV2(message: string, context?: any): string | undefined {
    if (context && typeof context.lang === 'string') return context.lang;
    const m = (message || '').toLowerCase();
    if (/[\u3040-\u30FF\u4E00-\u9FAF]/.test(message || '')) return 'ja';
    if (m.includes('english')) return 'en';
    return undefined;
  }

  private parseRelativeRangeV2(message: string, context?: any): { start: Date; end: Date } | null {
    const now = new Date();
    const m = (message || '').toLowerCase();
    const ja = message || '';
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
    const startOfWeekMon = (d: Date) => {
      const day = d.getDay();
      const diff = (day + 6) % 7;
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      s.setDate(s.getDate() - diff);
      s.setHours(0,0,0,0);
      return s;
    };
    const endOfWeekMon = (d: Date) => {
      const s = startOfWeekMon(d);
      const e = new Date(s.getTime());
      e.setDate(e.getDate() + 6);
      e.setHours(23,59,59,0);
      return e;
    };
    const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0);
    const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    if (m.includes('today') || ja.includes('今日')) return { start: startOfDay(now), end: endOfDay(now) };
    if (m.includes('tomorrow') || ja.includes('明日')) { const t = new Date(now); t.setDate(t.getDate()+1); return { start: startOfDay(t), end: endOfDay(t) }; }
    if (m.includes('yesterday') || ja.includes('昨日')) { const y = new Date(now); y.setDate(y.getDate()-1); return { start: startOfDay(y), end: endOfDay(y) }; }
    if (m.includes('this week') || ja.includes('今週')) return { start: startOfWeekMon(now), end: endOfWeekMon(now) };
    if (m.includes('next week') || ja.includes('来週')) { const n = new Date(now); n.setDate(n.getDate()+7); return { start: startOfWeekMon(n), end: endOfWeekMon(n) }; }
    if (m.includes('last week') || ja.includes('先週')) { const p = new Date(now); p.setDate(p.getDate()-7); return { start: startOfWeekMon(p), end: endOfWeekMon(p) }; }
    if (m.includes('this month') || ja.includes('今月')) return { start: startOfMonth(now), end: endOfMonth(now) };
    if (m.includes('recent') || ja.includes('最近') || ja.includes('直近')) {
      const s2 = new Date(now); const e2 = new Date(now); e2.setDate(e2.getDate()+7); s2.setHours(0,0,0,0); e2.setHours(23,59,59,0); return { start: s2, end: e2 };
    }
    return null;
  }

  private generateResponseV2(message: string, toolsUsed: any[], context?: any): { text: string; confidence: number; reasoning: string } {
    const ok = toolsUsed.filter(t => t.result && t.result.success);
    const fail = toolsUsed.filter(t => !t.result || !t.result.success);
    const lang = this.detectLanguagePreferenceV2(message, context) || 'en';
    let text = '';
    if (lang === 'ja') {
      if (ok.length) text += `ツールを実行しました: ${ok.map(t => t.toolName).join(', ')}。`;
      if (fail.length) text += `${text ? ' ' : ''}一部のツールが失敗しました: ${fail.map(t => t.toolName).join(', ')}。`;
      if (!text) text = 'ツールは実行されませんでした。';
    } else {
      if (ok.length) text += `Executed ${ok.length} tool(s): ${ok.map(t => t.toolName).join(', ')}.`;
      if (fail.length) text += `${text ? ' ' : ''}Some tools failed: ${fail.map(t => t.toolName).join(', ')}.`;
      if (!text) text = 'No tools were executed.';
    }
    return { text, confidence: ok.length ? 0.85 : 0.6, reasoning: 'Composed from tool execution results.' };
  }

  getRegisteredTools(): any[] {
    return this.toolRegistry.getAllDefinitions();
  }

  getToolsStatus(): any[] {
    return this.toolRegistry.getAllStatus();
  }

  getStatus(): {
    initialized: boolean;
    projectId: string;
    location: string;
    toolsCount: number;
    toolsStatus: any[];
  } {
    return {
      initialized: this.isInitialized,
      projectId: this.projectId,
      location: this.location,
      toolsCount: this.availableTools.length,
      toolsStatus: this.getToolsStatus()
    };
  }
}
