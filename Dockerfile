FROM node:24.11.1-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY webview-ui/package.json webview-ui/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run package

FROM node:24.11.1-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY webview-ui/package.json webview-ui/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 3100
VOLUME ["/root/.pixel-agents"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/cli.js", "--host", "0.0.0.0", "--port", "3100", "--no-manage-hooks"]
