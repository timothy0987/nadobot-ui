FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# We run node directly. Railway handles container restarts and orchestration,
# making PM2 redundant in a Dockerized environment.
CMD ["node", "dist/index.js"]
