import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { VertexAgentBrain } from './services/VertexAgentBrain.js';
import { setupRoutes } from './api/routes/index.js';
import { Logger } from './utils/Logger.js';
import { Metrics } from './utils/Metrics.js';

// Default timezone for the backend. Prefer Asia/Tokyo if not explicitly set.
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Tokyo';
}
const app = express();
const server = createServer(app);
const logger = new Logger('App');

// Middleware
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: ALLOW_ORIGIN, credentials: true }));
app.options('*', cors({ origin: ALLOW_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Initialize Agent Brain: 默认使用 Vertex AI Agent Builder 路径（生产优先，失败即暴露）
const agentBrain: any = new VertexAgentBrain();

// Setup routes
setupRoutes(app, agentBrain as any);

// Lightweight Prometheus metrics endpoint
app.get('/metrics', (_req, res) => {
  try {
    const text = Metrics.renderPrometheus();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).send(`# metrics render error: ${(e as Error).message}`);
  }
});

const PORT = parseInt(process.env.PORT || '8080');

// HTTP服务器优先启动
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`バックエンドサーバー起動: ポート ${PORT}`);
  logger.info('ヘルスチェック: /health');
  
  // 异步初始化Agent（不阻塞HTTP服务器）
  initializeAgent();
});

// 异步初始化Agent的函数
async function initializeAgent() {
  logger.info('エージェント初期化をバックグラウンドで開始...');
  
  try {
    // 异步初始化Agent
    await agentBrain.initialize();
  logger.info('エージェント初期化が完了しました');
    
    // 初始化成功后启动自主循环
    await agentBrain.start();
    logger.info('エージェントの自律ループを開始');
    
  } catch (error) {
    logger.error('エージェント初期化に失敗。限定モードで継続します', error);
    // HTTP服务器继续运行，只是Agent功能不可用
  }
}

// 优雅关闭处理
process.on('SIGTERM', async () => {
  logger.info('SIGTERM 受信。グレースフルシャットダウン');
  
  try {
    await agentBrain.stop();
    logger.info('エージェントを停止しました');
  } catch (error) {
    logger.error('エージェント停止時にエラー', error);
  }
  
  server.close(() => {
    logger.info('HTTP サーバーを終了');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT 受信。グレースフルシャットダウン');
  
  try {
    await agentBrain.stop();
    logger.info('エージェントを停止しました');
  } catch (error) {
    logger.error('エージェント停止時にエラー', error);
  }
  
  server.close(() => {
    logger.info('HTTP サーバーを終了');
    process.exit(0);
  });
});
