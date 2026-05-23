FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache ca-certificates

# Copy vendored deps first (no network needed)
COPY go.mod go.sum ./
COPY vendor/ vendor/
COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build \
    -mod=vendor \
    -ldflags="-s -w" \
    -o /dagviz-server \
    ./cmd/server

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /dagviz-server /dagviz-server
EXPOSE 8080
ENTRYPOINT ["/dagviz-server"]
