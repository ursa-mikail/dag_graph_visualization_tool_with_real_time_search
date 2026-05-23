FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# ─── Runtime: serve with Vite preview (or nginx) ─────────────────────────────
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY vite.config.ts ./
COPY index.html ./
COPY src ./src

EXPOSE 3000

# Use vite dev for hot-reload in dev; vite preview for built dist
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]
