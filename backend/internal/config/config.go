package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Address         string
	DatabaseURL     string
	MigrationsDir   string
	KayanRawDataDir string
	CatalogDataDir  string
	AutoMigrate     bool
	ImportOnStart   bool
	LeadWrites      bool
	AllowedOrigin   string
	RequestTimeout  time.Duration
	ShutdownTimeout time.Duration
	LeadCooldown    time.Duration
	LeadMaxInFlight int
}

func Load() Config {
	return Config{
		Address:         getenv("API_ADDR", "127.0.0.1:8080"),
		DatabaseURL:     getenv("DATABASE_URL", "postgres://catalog:catalog@localhost:5432/catalog?sslmode=disable"),
		MigrationsDir:   getenv("MIGRATIONS_DIR", "./migrations"),
		KayanRawDataDir: getenv("KAYAN_RAW_DATA_DIR", "./data/raw/kayan"),
		CatalogDataDir:  getenv("CATALOG_DATA_DIR", "../website/data"),
		AutoMigrate:     getenvBool("AUTO_MIGRATE", false),
		ImportOnStart:   getenvBool("IMPORT_ON_START", false),
		LeadWrites:      getenvBool("LEAD_WRITES_ENABLED", false),
		AllowedOrigin:   getenvAllowEmpty("ALLOWED_ORIGIN", "http://localhost:3000"),
		RequestTimeout:  getenvDuration("REQUEST_TIMEOUT", 10*time.Second),
		ShutdownTimeout: getenvDuration("SHUTDOWN_TIMEOUT", 10*time.Second),
		LeadCooldown:    getenvDuration("LEAD_DUPLICATE_WINDOW", time.Minute),
		LeadMaxInFlight: getenvPositiveInt("LEAD_MAX_IN_FLIGHT", 8),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvAllowEmpty(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getenvDuration(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func getenvPositiveInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 || parsed > 1024 {
		return fallback
	}
	return parsed
}
