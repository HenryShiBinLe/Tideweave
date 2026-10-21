# Tideweave 云同步服务（可顺带托管网页版）的容器镜像。用法见 server/README.md 的“用 Docker 部署”和根目录 compose.yaml。
# 服务端零依赖，只用 Node 自带模块，所以不需要 npm install；镜像里只放运行需要的文件（见 .dockerignore）。
FROM node:22-alpine

WORKDIR /app
COPY index.mjs store.mjs admin.mjs http-range.cjs ./server/

# 数据目录 /data 用卷挂载；以镜像自带的非 root 用户 node 运行，它只能写 /data
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    MIN_FREE_MB=500
USER node
VOLUME /data
EXPOSE 8080

# 健康检查走服务自己的接口；alpine 镜像里没有 curl，用 Node 自带的 fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# 直接以 node 为 1 号进程：服务端自己处理 SIGTERM（先关服务再退出），docker stop 不会等满 10 秒被强杀
CMD ["node", "server/index.mjs"]
