.PHONY: fmt test run ticket-bot enqueue-test-ticket cleanup-ticket-attachments import import-catalogs audit-catalogs db-up db-down compose-up

fmt:
	gofmt -w $$(find . -name '*.go' -not -path './vendor/*')

test:
	go test ./...

run:
	go run ./cmd/api

ticket-bot:
	go run ./cmd/ticket-bot

enqueue-test-ticket:
	go run ./cmd/ticket-bot enqueue-test

cleanup-ticket-attachments:
	go run ./cmd/ticket-bot cleanup-attachments --dry-run

import:
	go run ./cmd/import-kayan

import-catalogs:
	go run ./cmd/import-catalogs

audit-catalogs:
	go run ./cmd/import-catalogs -dry-run

db-up:
	docker compose up -d db

db-down:
	docker compose down

compose-up:
	docker compose up --build
