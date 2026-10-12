FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production CI=true PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY package.json package-lock.json ./
# Worker imports do not need the Eve development patch or application build.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY league.json ./league.json
COPY lib ./lib
COPY scripts/container-policy-service.mjs scripts/container-policy-worker.mjs scripts/container-policy-upload-worker.mjs scripts/container-policy-practice-worker.mjs ./scripts/
COPY workers/policy-build ./workers/policy-build
USER node
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "scripts/container-policy-service.mjs"]
