import winston from 'winston';
import { AgentConfig } from '../config/index.js';

// 日志格式定义
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, module, ...meta } = info;
    const metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}] [${module || 'APP'}] ${message} ${metaString}`;
  })
);

// 创建Winston logger实例
const createLogger = (module?: string) => {
  const config = AgentConfig.getServerConfig();
  
  return winston.createLogger({
    level: config.logLevel,
    format: logFormat,
    defaultMeta: { module },
    transports: [
      // 控制台输出
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
          winston.format.printf((info) => {
            const { timestamp, level, message, module, ...meta } = info;
            const metaString = Object.keys(meta).length > 0 ? 
              `\n${JSON.stringify(meta, null, 2)}` : '';
            return `${timestamp} [${level}] [${module || 'APP'}] ${message}${metaString}`;
          })
        )
      }),
    ],
  });
};

// 在生产环境添加文件输出
if (AgentConfig.isProduction()) {
  const baseLogger = createLogger();
  
  baseLogger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
  }));

  baseLogger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 10,
  }));
}

export class Logger {
  private logger: winston.Logger;

  constructor(module: string) {
    this.logger = createLogger(module);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  error(message: string, error?: Error | any, meta?: any): void {
    if (error instanceof Error) {
      this.logger.error(message, { 
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        ...meta 
      });
    } else if (error && typeof error === 'object') {
      this.logger.error(message, { error, ...meta });
    } else {
      this.logger.error(message, { error, ...meta });
    }
  }

  // Agent特定的日志方法
  agentAction(action: string, context?: any): void {
    this.info(`Agent执行行动: ${action}`, { 
      type: 'agent_action', 
      action,
      context 
    });
  }

  agentDecision(decision: string, confidence: number, context?: any): void {
    this.info(`Agent决策: ${decision}`, {
      type: 'agent_decision',
      decision,
      confidence,
      context
    });
  }

  agentLearning(pattern: string, improvement?: any): void {
    this.info(`Agent学习: ${pattern}`, {
      type: 'agent_learning',
      pattern,
      improvement
    });
  }

  performance(operation: string, duration: number, success: boolean): void {
    this.info(`性能指标: ${operation}`, {
      type: 'performance',
      operation,
      duration,
      success
    });
  }

  security(event: string, details?: any): void {
    this.warn(`安全事件: ${event}`, {
      type: 'security',
      event,
      details
    });
  }

  // 结构化日志方法
  structured(level: 'debug' | 'info' | 'warn' | 'error', data: LogData): void {
    this.logger[level]('', {
      type: data.type,
      category: data.category,
      operation: data.operation,
      result: data.result,
      duration: data.duration,
      metadata: data.metadata,
      timestamp: new Date().toISOString()
    });
  }
}

// 结构化日志数据接口
export interface LogData {
  type: 'agent' | 'api' | 'system' | 'user' | 'performance';
  category: string;
  operation: string;
  result: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  metadata?: Record<string, any>;
}

// 全局日志实例
export const AppLogger = new Logger('App');

// 性能监控装饰器
export function logPerformance(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;
  
  descriptor.value = async function (...args: any[]) {
    const startTime = Date.now();
    const logger = new Logger(target.constructor.name);
    
    try {
      const result = await originalMethod.apply(this, args);
      const duration = Date.now() - startTime;
      
      logger.performance(propertyKey, duration, true);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.performance(propertyKey, duration, false);
      logger.error(`方法 ${propertyKey} 执行失败`, error);
      throw error;
    }
  };
  
  return descriptor;
}

// 错误日志装饰器
export function logErrors(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;
  
  descriptor.value = async function (...args: any[]) {
    const logger = new Logger(target.constructor.name);
    
    try {
      return await originalMethod.apply(this, args);
    } catch (error) {
      logger.error(`方法 ${propertyKey} 出现错误`, error);
      throw error;
    }
  };
  
  return descriptor;
}

export default Logger;