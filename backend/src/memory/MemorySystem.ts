/**
 * Agent记忆系统 - 第4阶段核心架构
 * 
 * 实现三类记忆系统和Vertex AI Vector Search集成：
 * 1. Episodic Memory (情景记忆)：观测→推理→行动→结果→奖励完整链路
 * 2. Semantic Memory (语义记忆)：知识库、FAQs、会议模式规则
 * 3. Procedural Memory (程序记忆)：决策模板、议程模板、行动剧本
 */

import { Logger } from '../utils/Logger.js';

export enum MemoryType {
  EPISODIC = 'episodic',     // 情景记忆：具体经历和经验
  SEMANTIC = 'semantic',     // 语义记忆：知识和事实
  PROCEDURAL = 'procedural'  // 程序记忆：技能和流程
}

export enum MemoryCategory {
  // Episodic categories
  MEETING_EXPERIENCE = 'meeting_experience',
  EMAIL_INTERACTION = 'email_interaction', 
  DECISION_OUTCOME = 'decision_outcome',
  CONFLICT_RESOLUTION = 'conflict_resolution',
  
  // Semantic categories  
  FAQ_KNOWLEDGE = 'faq_knowledge',
  MEETING_RULES = 'meeting_rules',
  COMPANY_POLICY = 'company_policy',
  BEST_PRACTICES = 'best_practices',
  
  // Procedural categories
  DECISION_TEMPLATE = 'decision_template',
  AGENDA_TEMPLATE = 'agenda_template',
  ACTION_SCRIPT = 'action_script',
  WORKFLOW_PATTERN = 'workflow_pattern'
}

export interface MemoryMetadata {
  id: string;
  type: MemoryType;
  category: MemoryCategory;
  timestamp: Date;
  source: string;        // 记忆来源：event_id, user_input, system_learning
  confidence: number;    // 置信度 0-1
  privacy: 'public' | 'internal' | 'confidential' | 'restricted';
  tags: string[];       // 标签用于分类和检索
  version: number;      // 记忆版本（支持更新）
  parentId?: string;    // 父记忆ID（用于记忆链接）
  relatedIds?: string[]; // 相关记忆IDs
}

export interface BaseMemory {
  metadata: MemoryMetadata;
  content: any;         // 记忆具体内容
  embedding?: number[]; // 向量嵌入（用于相似度搜索）
  retrievalCount: number; // 被检索次数
  lastRetrieved?: Date;   // 最后检索时间
  effectiveness?: number; // 记忆有效性评分
}

/**
 * Episodic Memory - 情景记忆
 * 记录具体的经历：观测→推理→行动→结果→奖励
 */
export interface EpisodicMemory extends BaseMemory {
  content: {
    // 观测阶段
    observation: {
      context: any;           // 环境上下文
      triggers: string[];     // 触发事件
      initialState: any;      // 初始状态
    };
    
    // 推理阶段  
    reasoning: {
      analysis: string;       // 分析过程
      considerations: string[]; // 考虑因素
      alternatives: any[];    // 备选方案
      selectedReason: string; // 选择理由
      confidence: number;     // 推理置信度
    };
    
    // 行动阶段
    action: {
      type: string;          // 行动类型
      parameters: any;       // 行动参数
      tools_used: string[];  // 使用的工具
      execution_time: Date;  // 执行时间
      execution_duration: number; // 执行耗时(ms)
    };
    
    // 结果阶段
    result: {
      success: boolean;      // 是否成功
      outcome: any;         // 具体结果
      side_effects: any[];  // 副作用
      user_feedback?: {     // 用户反馈
        satisfaction: number; // 满意度 1-5
        comments?: string;
      };
    };
    
    // 奖励阶段（学习信号）
    reward: {
      time_saved?: number;      // 节省时间(分钟)
      decision_count?: number;  // 决策数量
      conflicts_resolved?: number; // 解决冲突数
      satisfaction?: number;    // 满意度
      rollbacks?: number;      // 回滚次数
      total_score: number;     // 总奖励分数
    };
  };
}

/**
 * Semantic Memory - 语义记忆  
 * 存储知识、事实、规则
 */
export interface SemanticMemory extends BaseMemory {
  content: {
    knowledge_type: 'fact' | 'rule' | 'guideline' | 'policy' | 'faq';
    title: string;
    description: string;
    details: any;
    
    // 知识来源和验证
    sources: string[];        // 知识来源
    verified: boolean;        // 是否已验证
    verification_date?: Date; // 验证日期
    
    // 应用场景
    applicable_contexts: string[]; // 适用场景
    examples: any[];              // 应用示例
    
    // 知识关系
    dependencies?: string[];   // 依赖的其他知识
    conflicts?: string[];     // 冲突的知识
  };
}

/**
 * Procedural Memory - 程序记忆
 * 存储流程、模板、技能
 */
export interface ProceduralMemory extends BaseMemory {
  content: {
    procedure_type: 'template' | 'workflow' | 'script' | 'pattern';
    name: string;
    description: string;
    
    // 程序定义
    steps: Array<{
      step_number: number;
      description: string;
      action: string;
      parameters?: any;
      conditions?: string[];   // 执行条件
      expected_outcome?: string;
    }>;
    
    // 程序元数据
    triggers: string[];        // 触发条件
    prerequisites: string[];   // 前置条件  
    success_criteria: string[]; // 成功标准
    
    // 使用统计
    usage_count: number;       // 使用次数
    success_rate: number;      // 成功率
    average_duration: number;  // 平均执行时间
    
    // 程序优化
    variations: Array<{       // 变体版本
      name: string;
      modifications: any[];
      performance: number;
    }>;
  };
}

export type Memory = EpisodicMemory | SemanticMemory | ProceduralMemory;

export interface MemorySearchQuery {
  query: string;              // 搜索查询
  type?: MemoryType;         // 限制记忆类型
  categories?: MemoryCategory[]; // 限制分类
  tags?: string[];           // 标签过滤
  timeRange?: {              // 时间范围
    start: Date;
    end: Date;
  };
  confidenceRange?: {        // 置信度范围
    min: number;
    max: number;  
  };
  privacy?: ('public' | 'internal' | 'confidential' | 'restricted')[];
  limit?: number;            // 返回数量限制
  includeEmbedding?: boolean; // 是否包含向量
}

export interface MemorySearchResult {
  memory: Memory;
  similarity: number;        // 相似度评分
  relevance: number;        // 相关性评分
  explanation: string;      // 匹配解释
  highlighted_content?: string; // 高亮匹配内容
}

export interface MemoryInsight {
  query: string;
  total_results: number;
  top_results: MemorySearchResult[];
  insights: {
    patterns_found: string[];    // 发现的模式
    recommendations: string[];   // 基于记忆的建议
    related_experiences: string[]; // 相关经历
    knowledge_gaps: string[];    // 知识空缺
  };
  explanation_chain: {
    reasoning_steps: string[];   // 推理步骤
    memory_references: string[]; // 记忆引用
    confidence_scores: number[]; // 各步骤置信度
  };
}

/**
 * 记忆系统核心类
 */
export class MemorySystem {
  private logger: Logger;
  private memories: Map<string, Memory>;
  private memoryIndex: Map<string, Set<string>>; // 标签和分类索引
  
  // Vector Search 相关（将在后续实现中集成真实的Vector Search）
  private vectorSearchEnabled: boolean = false;
  private embeddingModel: string = 'textembedding-gecko@003';

  constructor() {
    this.logger = new Logger('MemorySystem');
    this.memories = new Map();
    this.memoryIndex = new Map();
    this.initializeBaseKnowledge();
  }

  /**
   * 初始化基础知识
   */
  private initializeBaseKnowledge(): void {
    // 基本的セマンティック知識を初期投入（内容は日本語、キーは英語）
    const basicKnowledge: SemanticMemory[] = [
      {
        metadata: {
          id: 'basic_meeting_rules',
          type: MemoryType.SEMANTIC,
          category: MemoryCategory.MEETING_RULES,
          timestamp: new Date(),
          source: 'system_initialization',
          confidence: 0.9,
          privacy: 'internal',
          tags: ['会議', 'ルール', 'マナー'],
          version: 1
        },
        content: {
          knowledge_type: 'rule',
          title: '会議の基本ルール',
          description: '標準的な会議運用とマナーに関するルール',
          details: {
            rules: [
              '会議には明確なアジェンダを用意する',
              '重要な決定事項は記録する',
              '参加者は事前に出欠を確認する',
              '時間重複の会議は再調整する',
              'キャンセルは関係者全員に事前通知する'
            ]
          },
          sources: ['company_handbook', 'meeting_best_practices'],
          verified: true,
          verification_date: new Date(),
          applicable_contexts: ['meeting_scheduling', 'meeting_management'],
          examples: []
        },
        retrievalCount: 0,
        effectiveness: 0.85
      }
    ];

    basicKnowledge.forEach(memory => {
      this.storeMemory(memory);
    });

    this.logger.info('Memory system initialized with basic knowledge', {
      totalMemories: this.memories.size,
      semanticMemories: basicKnowledge.length
    });
  }

  /**
   * 存储记忆
   */
  public storeMemory(memory: Memory): string {
    const memoryId = memory.metadata.id;
    
    // 存储记忆
    this.memories.set(memoryId, memory);
    
    // 更新索引
    this.updateIndex(memory);
    
    this.logger.info('Memory stored successfully', {
      memoryId,
      type: memory.metadata.type,
      category: memory.metadata.category,
      tags: memory.metadata.tags
    });

    return memoryId;
  }

  /**
   * 存储情景记忆（快捷方法）
   */
  public storeEpisodicMemory(
    observation: any,
    reasoning: any,
    action: any,
    result: any,
    reward: any,
    metadata?: Partial<MemoryMetadata>
  ): string {
    const episodicMemory: EpisodicMemory = {
      metadata: {
        id: `episodic_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        type: MemoryType.EPISODIC,
        category: MemoryCategory.DECISION_OUTCOME,
        timestamp: new Date(),
        source: 'agent_experience',
        confidence: 0.8,
        privacy: 'internal',
        tags: [],
        version: 1,
        ...metadata
      },
      content: {
        observation,
        reasoning,
        action, 
        result,
        reward
      },
      retrievalCount: 0,
      effectiveness: reward.total_score / 100 // 基于奖励计算有效性
    };

    return this.storeMemory(episodicMemory);
  }

  /**
   * 搜索记忆
   */
  public async searchMemories(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];
    const searchTerms = query.query.toLowerCase().split(' ');

    for (const [memoryId, memory] of this.memories) {
      // 基本过滤
      if (query.type && memory.metadata.type !== query.type) continue;
      if (query.categories && !query.categories.includes(memory.metadata.category)) continue;
      if (query.privacy && !query.privacy.includes(memory.metadata.privacy)) continue;
      
      // 时间范围过滤
      if (query.timeRange) {
        if (memory.metadata.timestamp < query.timeRange.start ||
            memory.metadata.timestamp > query.timeRange.end) continue;
      }

      // 置信度过滤
      if (query.confidenceRange) {
        if (memory.metadata.confidence < query.confidenceRange.min ||
            memory.metadata.confidence > query.confidenceRange.max) continue;
      }

      // 内容匹配（简化版本，真实实现会使用Vector Search）
      const matchScore = this.calculateMatchScore(memory, searchTerms);
      if (matchScore > 0.1) { // 最低匹配阈值
        results.push({
          memory,
          similarity: matchScore,
          relevance: matchScore * memory.metadata.confidence,
          explanation: this.generateMatchExplanation(memory, searchTerms),
          highlighted_content: this.highlightContent(memory, searchTerms)
        });
      }
    }

    // 排序并限制结果
    results.sort((a, b) => b.relevance - a.relevance);
    
    if (query.limit) {
      results.splice(query.limit);
    }

    this.logger.info('Memory search completed', {
      query: query.query,
      totalResults: results.length,
      topRelevance: results[0]?.relevance || 0
    });

    return results;
  }

  /**
   * 生成记忆洞察
   */
  public async generateMemoryInsights(query: string): Promise<MemoryInsight> {
    const searchResults = await this.searchMemories({
      query,
      limit: 10,
      includeEmbedding: false
    });

    const insights: MemoryInsight = {
      query,
      total_results: searchResults.length,
      top_results: searchResults.slice(0, 5),
      insights: {
        patterns_found: this.identifyPatterns(searchResults),
        recommendations: this.generateRecommendations(searchResults),
        related_experiences: this.findRelatedExperiences(searchResults),
        knowledge_gaps: this.identifyKnowledgeGaps(query, searchResults)
      },
      explanation_chain: {
        reasoning_steps: this.generateReasoningSteps(query, searchResults),
        memory_references: searchResults.map(r => r.memory.metadata.id),
        confidence_scores: searchResults.map(r => r.memory.metadata.confidence)
      }
    };

    return insights;
  }

  /**
   * 更新索引
   */
  private updateIndex(memory: Memory): void {
    // 按类型索引
    const typeKey = `type:${memory.metadata.type}`;
    if (!this.memoryIndex.has(typeKey)) {
      this.memoryIndex.set(typeKey, new Set());
    }
    this.memoryIndex.get(typeKey)!.add(memory.metadata.id);

    // 按分类索引
    const categoryKey = `category:${memory.metadata.category}`;
    if (!this.memoryIndex.has(categoryKey)) {
      this.memoryIndex.set(categoryKey, new Set());
    }
    this.memoryIndex.get(categoryKey)!.add(memory.metadata.id);

    // 按标签索引
    memory.metadata.tags.forEach(tag => {
      const tagKey = `tag:${tag}`;
      if (!this.memoryIndex.has(tagKey)) {
        this.memoryIndex.set(tagKey, new Set());
      }
      this.memoryIndex.get(tagKey)!.add(memory.metadata.id);
    });
  }

  /**
   * 计算匹配分数（简化版本）
   */
  private calculateMatchScore(memory: Memory, searchTerms: string[]): number {
    const contentStr = JSON.stringify(memory.content).toLowerCase();
    const metadataStr = JSON.stringify(memory.metadata).toLowerCase();
    const combinedStr = contentStr + ' ' + metadataStr;

    let matchCount = 0;
    searchTerms.forEach(term => {
      if (combinedStr.includes(term)) {
        matchCount++;
      }
    });

    return matchCount / searchTerms.length;
  }

  /**
   * 生成匹配解释
   */
  private generateMatchExplanation(memory: Memory, searchTerms: string[]): string {
    return `匹配基于${memory.metadata.type}类型记忆，包含相关内容和上下文信息`;
  }

  /**
   * 高亮匹配内容
   */
  private highlightContent(memory: Memory, searchTerms: string[]): string {
    const contentStr = JSON.stringify(memory.content, null, 2);
    return contentStr.substring(0, 200) + '...'; // 简化版本
  }

  /**
   * 识别模式
   */
  private identifyPatterns(results: MemorySearchResult[]): string[] {
    // 简化版本的模式识别
    const patterns: string[] = [];
    
    const typeCount: {[key: string]: number} = {};
    results.forEach(r => {
      typeCount[r.memory.metadata.type] = (typeCount[r.memory.metadata.type] || 0) + 1;
    });

    Object.entries(typeCount).forEach(([type, count]) => {
      if (count > 1) {
        patterns.push(`发现${count}个${type}类型的相关记忆`);
      }
    });

    return patterns;
  }

  /**
   * 生成建议
   */
  private generateRecommendations(results: MemorySearchResult[]): string[] {
    const recommendations: string[] = [];
    
    if (results.length > 0) {
      const bestResult = results[0];
      if (bestResult.memory.metadata.type === MemoryType.EPISODIC) {
        recommendations.push('基于过往经验，建议采用类似的处理方式');
      } else if (bestResult.memory.metadata.type === MemoryType.PROCEDURAL) {
        recommendations.push('可以参考已有的流程模板');
      }
    }

    return recommendations;
  }

  /**
   * 找到相关经历
   */
  private findRelatedExperiences(results: MemorySearchResult[]): string[] {
    return results
      .filter(r => r.memory.metadata.type === MemoryType.EPISODIC)
      .map(r => `相关经历：${r.memory.metadata.id}`)
      .slice(0, 3);
  }

  /**
   * 识别知识空缺
   */
  private identifyKnowledgeGaps(query: string, results: MemorySearchResult[]): string[] {
    const gaps: string[] = [];
    
    if (results.length === 0) {
      gaps.push(`缺乏关于"${query}"的相关记忆`);
    } else if (results.length < 3) {
      gaps.push(`关于"${query}"的记忆较少，建议积累更多经验`);
    }

    return gaps;
  }

  /**
   * 生成推理步骤
   */
  private generateReasoningSteps(query: string, results: MemorySearchResult[]): string[] {
    const steps = [
      `分析查询："${query}"`,
      `搜索相关记忆库，找到${results.length}个匹配项`,
    ];

    if (results.length > 0) {
      steps.push(`识别最相关记忆：${results[0].memory.metadata.category}`);
      steps.push(`基于记忆置信度和相关性进行排序`);
    }

    return steps;
  }

  /**
   * 获取系统统计
   */
  public getStats(): {
    totalMemories: number;
    memoriesByType: {[key in MemoryType]: number};
    memoriesByCategory: {[key: string]: number};
    averageConfidence: number;
    totalRetrievals: number;
  } {
    const stats = {
      totalMemories: this.memories.size,
      memoriesByType: {
        [MemoryType.EPISODIC]: 0,
        [MemoryType.SEMANTIC]: 0,
        [MemoryType.PROCEDURAL]: 0
      },
      memoriesByCategory: {} as {[key: string]: number},
      averageConfidence: 0,
      totalRetrievals: 0
    };

    let totalConfidence = 0;
    
    for (const memory of this.memories.values()) {
      stats.memoriesByType[memory.metadata.type]++;
      
      const category = memory.metadata.category;
      stats.memoriesByCategory[category] = (stats.memoriesByCategory[category] || 0) + 1;
      
      totalConfidence += memory.metadata.confidence;
      stats.totalRetrievals += memory.retrievalCount;
    }

    stats.averageConfidence = this.memories.size > 0 ? totalConfidence / this.memories.size : 0;

    return stats;
  }

  /**
   * 获取记忆详情
   */
  public getMemory(memoryId: string): Memory | undefined {
    const memory = this.memories.get(memoryId);
    if (memory) {
      memory.retrievalCount++;
      memory.lastRetrieved = new Date();
    }
    return memory;
  }

  /**
   * 删除记忆
   */
  public deleteMemory(memoryId: string): boolean {
    const deleted = this.memories.delete(memoryId);
    
    // 从索引中移除
    for (const [indexKey, memorySet] of this.memoryIndex) {
      memorySet.delete(memoryId);
    }

    if (deleted) {
      this.logger.info('Memory deleted', { memoryId });
    }

    return deleted;
  }

  /**
   * 清理低效记忆
   */
  public cleanupIneffectiveMemories(threshold: number = 0.3): number {
    let cleanedCount = 0;
    
    for (const [memoryId, memory] of this.memories) {
      if (memory.effectiveness !== undefined && memory.effectiveness < threshold) {
        this.deleteMemory(memoryId);
        cleanedCount++;
      }
    }

    this.logger.info('Cleaned up ineffective memories', {
      cleanedCount,
      threshold,
      remainingMemories: this.memories.size
    });

    return cleanedCount;
  }
}
