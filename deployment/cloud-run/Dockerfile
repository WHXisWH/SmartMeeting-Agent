# SmartMeet AI Agent Brain - Cloud Run优化版本
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY backend/package*.json ./

# 安装依赖
RUN npm ci --only=production && npm cache clean --force

# 复制源代码
COPY backend/src ./src
COPY backend/tsconfig.json ./

# 构建应用
RUN npm run build

# 生产阶段 - Cloud Run优化
FROM node:18-alpine AS production

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 安装必要的系统包
RUN apk add --no-cache \
    curl \
    ca-certificates && \
    update-ca-certificates

# 设置工作目录
WORKDIR /app

# 从builder阶段复制文件
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# 创建日志目录
RUN mkdir -p logs && chown -R nodejs:nodejs logs

# 切换到非root用户
USER nodejs

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=8080

# 暴露端口
EXPOSE 8080

# 健康检查 - Cloud Run优化
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# 启动命令 - 使用exec form以确保信号正确传递
CMD ["node", "dist/index.js"]