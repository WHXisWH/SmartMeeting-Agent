import dotenv from 'dotenv';
import { z } from 'zod';

// 加载环境变量
dotenv.config();

// 配置验证模式
const ConfigSchema = z.object({
  // 基础配置
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Google Cloud 配置
  GOOGLE_CLOUD_PROJECT_ID: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z.string().optional(),

  // Vertex AI 配置
  VERTEX_AI_LOCATION: z.string().default('asia-northeast1'),
  VERTEX_AI_MODEL: z.string().default('gemini-1.5-pro'),

  // Webhook 配置
  WEBHOOK_BASE_URL: z.string().url(),
  WEBHOOK_TOKEN: z.string().min(1),

  // 数据库配置
  FIRESTORE_DATABASE_ID: z.string().default('(default)'),
  VECTOR_SEARCH_INDEX_ID: z.string().optional(),

  // Agent 配置
  AGENT_AUTONOMY_LEVEL: z.coerce.number().min(0).max(1).default(0.7),
  AGENT_PROACTIVE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  AGENT_AUTONOMOUS_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
  AGENT_ESCALATION_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
  AGENT_LEARNING_RATE: z.coerce.number().min(0).max(1).default(0.1),
  AGENT_MAX_DECISIONS_PER_HOUR: z.coerce.number().min(0).default(10),

  // 安全配置
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // 监控配置
  ENABLE_METRICS: z.coerce.boolean().default(true),
  METRICS_PORT: z.coerce.number().default(9090),

  // 缓存配置
  REDIS_URL: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().default(3600),
});

type Config = z.infer<typeof ConfigSchema>;

// 验证环境变量
let config: Config;

try {
  config = ConfigSchema.parse(process.env);
} catch (error) {
  console.error('Configuration validation failed:', error);
  process.exit(1);
}

// Agent 配置类
export class AgentConfig {
  static getAgentConfig() {
    return {
      autonomyLevel: config.AGENT_AUTONOMY_LEVEL,
      proactiveThreshold: config.AGENT_PROACTIVE_THRESHOLD,
      autonomousThreshold: config.AGENT_AUTONOMOUS_THRESHOLD,
      escalationThreshold: config.AGENT_ESCALATION_THRESHOLD,
      learningRate: config.AGENT_LEARNING_RATE,
      maxDecisionsPerHour: config.AGENT_MAX_DECISIONS_PER_HOUR,
    };
  }

  static getGoogleCloudConfig() {
    return {
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      redirectUri: config.GOOGLE_REDIRECT_URI,
      serviceAccountKeyPath: config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    };
  }

  static getVertexAIConfig() {
    return {
      location: config.VERTEX_AI_LOCATION,
      model: config.VERTEX_AI_MODEL,
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
    };
  }

  static getWebhookConfig() {
    return {
      baseUrl: config.WEBHOOK_BASE_URL,
      token: config.WEBHOOK_TOKEN,
    };
  }

  static getDatabaseConfig() {
    return {
      projectId: config.GOOGLE_CLOUD_PROJECT_ID,
      databaseId: config.FIRESTORE_DATABASE_ID,
      vectorSearchIndexId: config.VECTOR_SEARCH_INDEX_ID,
    };
  }

  static getServerConfig() {
    return {
      port: config.PORT,
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
      jwtSecret: config.JWT_SECRET,
      corsOrigin: config.CORS_ORIGIN,
    };
  }

  static getMonitoringConfig() {
    return {
      enableMetrics: config.ENABLE_METRICS,
      metricsPort: config.METRICS_PORT,
    };
  }

  static getCacheConfig() {
    return {
      redisUrl: config.REDIS_URL,
      ttlSeconds: config.CACHE_TTL_SECONDS,
    };
  }

  static isDevelopment(): boolean {
    return config.NODE_ENV === 'development';
  }

  static isProduction(): boolean {
    return config.NODE_ENV === 'production';
  }

}

export default config;
