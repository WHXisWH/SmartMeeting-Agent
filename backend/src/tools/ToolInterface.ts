/**
 * 统一工具接口定义 - 第2阶段兼容层核心
 * 
 * 这个接口为所有工具（Calendar, Gmail, Drive, Decision等）提供统一的抽象，
 * 使得Vertex AI Agent Builder能够通过标准化接口调用各种功能工具。
 */

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    executionTime: number;
    confidence?: number;
    source?: string;
    [key: string]: any;
  };
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  defaultValue?: any;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'calendar' | 'gmail' | 'drive' | 'decision' | 'utility';
  parameters: ToolParameter[];
  examples?: Array<{
    input: Record<string, any>;
    expectedOutput: any;
    description: string;
  }>;
}

/**
 * 基础工具抽象类 - 所有工具都应继承此类
 */
export abstract class BaseTool {
  protected readonly name: string;
  protected readonly description: string;
  protected readonly category: string;
  protected isInitialized: boolean = false;
  protected initializationError: Error | null = null;

  constructor(name: string, description: string, category: string) {
    this.name = name;
    this.description = description;
    this.category = category;
  }

  /**
   * 获取工具定义 - 供Agent Builder注册使用
   */
  abstract getDefinition(): ToolDefinition;

  /**
   * 执行工具功能 - 核心执行方法
   */
  abstract execute(parameters: Record<string, any>): Promise<ToolExecutionResult>;

  /**
   * 异步初始化工具 - 设置API连接等
   */
  abstract initialize(): Promise<void>;

  /**
   * 验证输入参数
   */
  protected validateParameters(parameters: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const definition = this.getDefinition();

    // 检查必需参数
    for (const param of definition.parameters.filter(p => p.required)) {
      if (!(param.name in parameters) || parameters[param.name] === undefined || parameters[param.name] === null) {
        errors.push(`Required parameter '${param.name}' is missing`);
      }
    }

    // 类型验证
    for (const param of definition.parameters) {
      const value = parameters[param.name];
      if (value !== undefined && value !== null) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (param.type === 'object' && actualType !== 'object') {
          errors.push(`Parameter '${param.name}' should be object, got ${actualType}`);
        } else if (param.type !== 'object' && param.type !== actualType) {
          errors.push(`Parameter '${param.name}' should be ${param.type}, got ${actualType}`);
        }

        // 范围验证
        if (param.validation) {
          if (param.validation.min !== undefined && typeof value === 'number' && value < param.validation.min) {
            errors.push(`Parameter '${param.name}' should be >= ${param.validation.min}`);
          }
          if (param.validation.max !== undefined && typeof value === 'number' && value > param.validation.max) {
            errors.push(`Parameter '${param.name}' should be <= ${param.validation.max}`);
          }
          if (param.validation.enum && !param.validation.enum.includes(value)) {
            errors.push(`Parameter '${param.name}' should be one of: ${param.validation.enum.join(', ')}`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 获取工具状态
   */
  public getStatus(): { 
    name: string; 
    initialized: boolean; 
    error: string | null; 
    category: string;
  } {
    return {
      name: this.name,
      initialized: this.isInitialized,
      error: this.initializationError?.message || null,
      category: this.category
    };
  }

  /**
   * 包装执行结果，确保统一格式
   */
  protected createResult(
    success: boolean, 
    data?: any, 
    error?: string,
    additionalMetadata?: Record<string, any>
  ): ToolExecutionResult {
    const startTime = Date.now();
    
    return {
      success,
      data,
      error,
      metadata: {
        executionTime: Date.now() - startTime,
        source: this.name,
        timestamp: new Date().toISOString(),
        ...additionalMetadata
      }
    };
  }
}

/**
 * 工具注册表 - 管理所有可用工具
 */
export class ToolRegistry {
  private tools = new Map<string, BaseTool>();
  private static instance: ToolRegistry | null = null;

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * 注册工具
   */
  public register(tool: BaseTool): void {
    this.tools.set(tool.getDefinition().name, tool);
  }

  /**
   * 获取工具
   */
  public getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具定义 - 供Agent Builder使用
   */
  public getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => tool.getDefinition());
  }

  /**
   * 获取按类别分组的工具
   */
  public getToolsByCategory(): Record<string, ToolDefinition[]> {
    const grouped: Record<string, ToolDefinition[]> = {};
    
    for (const tool of this.tools.values()) {
      const definition = tool.getDefinition();
      if (!grouped[definition.category]) {
        grouped[definition.category] = [];
      }
      grouped[definition.category].push(definition);
    }
    
    return grouped;
  }

  /**
   * 执行工具
   */
  public async executeTool(name: string, parameters: Record<string, any>): Promise<ToolExecutionResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${name}' not found`,
        metadata: {
          executionTime: 0,
          source: 'ToolRegistry'
        }
      };
    }

    if (!tool.getStatus().initialized) {
      return {
        success: false,
        error: `Tool '${name}' is not initialized`,
        metadata: {
          executionTime: 0,
          source: 'ToolRegistry'
        }
      };
    }

    try {
      return await tool.execute(parameters);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown execution error',
        metadata: {
          executionTime: 0,
          source: name
        }
      };
    }
  }

  /**
   * 初始化所有工具
   */
  public async initializeAll(): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    for (const tool of this.tools.values()) {
      try {
        if (!tool.getStatus().initialized) {
          await tool.initialize();
        }
      } catch (error) {
        const errorMessage = `Failed to initialize tool '${tool.getDefinition().name}': ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        errors.push(errorMessage);
      }
    }

    return {
      success: errors.length === 0,
      errors
    };
  }

  /**
   * 获取所有工具状态
   */
  public getAllStatus(): Array<{ 
    name: string; 
    initialized: boolean; 
    error: string | null; 
    category: string;
  }> {
    return Array.from(this.tools.values()).map(tool => tool.getStatus());
  }
}