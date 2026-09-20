FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl is used by the compose healthcheck.
RUN apk add --no-cache curl

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node
EXPOSE 4000

# Direct exec, no npm wrapper, so SIGTERM reaches node and shutdown is clean.
CMD ["node", "src/index.js"]
