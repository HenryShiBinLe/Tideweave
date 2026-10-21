# Tideweave 云同步服务的容器镜像。用法见 server/README.md 的“用 Docker 部署”和根目录 compose.yaml。
# 服务端零依赖，只用 Node 自带模块，所以不需要 npm install；镜像里只放运行需要的文件（见 .dockerignore）。
#
# 两个构建目标：
#   server（默认）：只有同步服务，网页目录靠挂载
#     docker build -t tideweave-sync server
#   full：同步服务 + 网页版，网页目录通过名为 web 的构建上下文传进来（任意构建好的网页目录，例如 dist/）
#     docker build --target full --build-context web=dist -t tideweave server
#   发布到 ghcr.io 的镜像就是 full 目标。

FROM node:22-alpine AS server
LABEL org.opencontainers.image.source="https://github.com/HenryShiBinLe/Tideweave" \
      org.opencontainers.image.title="Tideweave" \
      org.opencontainers.image.description="脉序 · Tideweave 云同步服务"
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

# 带网页版：文件归 root、对 node 用户只读，服务只能读不能改
FROM server AS full
LABEL org.opencontainers.image.description="脉序 · Tideweave：云同步服务 + 网页版"
COPY --from=web --chown=root:root . /srv/www
ENV STATIC_DIR=/srv/www
