FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/

RUN npm ci --ignore-scripts

# Build TypeScript
RUN cd apps/api && npm run build

EXPOSE 5000

CMD ["sh", "-c", "cd apps/api && npm start"]
