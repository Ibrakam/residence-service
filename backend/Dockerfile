FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/catalog-api ./cmd/api

FROM alpine:3.22
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /out/catalog-api /usr/local/bin/catalog-api
COPY migrations ./migrations
USER app
EXPOSE 8080
ENTRYPOINT ["catalog-api"]
