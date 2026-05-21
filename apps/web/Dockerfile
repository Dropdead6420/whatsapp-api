FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

RUN npm ci --ignore-scripts

# Build
RUN cd apps/web && npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/ packages/
COPY apps/web/package.json apps/web/package.json

RUN npm ci --ignore-scripts --production

COPY --from=builder /app/apps/web/.next apps/web/.next

# Copy public if it exists
RUN mkdir -p apps/web/public

EXPOSE 3000

CMD ["sh", "-c", "cd apps/web && npm start"]
