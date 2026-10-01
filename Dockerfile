FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM golang:1.23-bookworm AS backend
WORKDIR /src/backend
COPY backend/go.mod ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/api ./cmd/api && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/worker ./cmd/worker && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/migrate ./cmd/migrate

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata curl postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /out/api /app/api
COPY --from=backend /out/worker /app/worker
COPY --from=backend /out/migrate /app/migrate
COPY --from=frontend /src/frontend/dist /app/frontend
COPY database/migrations /app/migrations
RUN useradd -r -u 10001 -m salesportal && mkdir -p /var/lib/salesportal/backups && chown -R salesportal:salesportal /var/lib/salesportal /app
USER salesportal
ENTRYPOINT ["/app/api"]
