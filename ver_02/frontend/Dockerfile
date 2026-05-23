FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3001"]
