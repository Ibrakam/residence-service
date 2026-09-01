.PHONY: fmt test run import import-catalogs audit-catalogs db-up db-down compose-up

fmt:
	gofmt -w $$(find . -name '*.go' -not -path './vendor/*')

test:
	go test ./...

run:
	go run ./cmd/api

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
