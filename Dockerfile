FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /app/data && chown -R appuser:appgroup /app/data

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
