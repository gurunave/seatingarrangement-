# Seat Draft — one small Node process, no build step.
FROM node:22-alpine

WORKDIR /app

# Install production dependencies first so this layer caches across code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# The room layout is saved here; mount a volume at /app/data to keep it
# across container restarts and upgrades.
RUN mkdir -p data
VOLUME /app/data

ENV NODE_ENV=production
EXPOSE 3000

# Run as the unprivileged user the node image ships with.
RUN chown -R node:node /app/data
USER node

CMD ["node", "server/index.js"]
