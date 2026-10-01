package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env                 string
	HTTPAddr            string
	DatabaseURL         string
	SessionCookieName   string
	SessionTTL          time.Duration
	Pepper              string
	Timezone            string
	ParallelMode        bool
	DriveFolderID       string
	DriveServiceAccount string
	DrivePollInterval   time.Duration
	BackupDir           string
	BackupRetentionDays int
	AIBaseURL           string
	AIAPIKey            string
	AIModel             string
	PublicBaseURL       string
	LogLevel            string
	SlowQueryThreshold  time.Duration
}

func Load() (Config, error) {
	c := Config{
		Env:                 getenv("APP_ENV", "production"),
		HTTPAddr:            getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:         strings.TrimSpace(os.Getenv("DATABASE_URL")),
		SessionCookieName:   getenv("SESSION_COOKIE_NAME", "sp_session"),
		SessionTTL:          duration("SESSION_TTL", 12*time.Hour),
		Pepper:              os.Getenv("AUTH_PEPPER"),
		Timezone:            getenv("APP_TIMEZONE", "Asia/Jakarta"),
		ParallelMode:        boolenv("PARALLEL_MODE", true),
		DriveFolderID:       strings.TrimSpace(os.Getenv("DRIVE_FINISHED_FOLDER_ID")),
		DriveServiceAccount: getenv("GOOGLE_APPLICATION_CREDENTIALS", "/run/secrets/google-service-account.json"),
		DrivePollInterval:   duration("DRIVE_POLL_INTERVAL", 15*time.Minute),
		BackupDir:           getenv("BACKUP_DIR", "/var/lib/salesportal/backups"),
		BackupRetentionDays: intenv("BACKUP_RETENTION_DAYS", 30),
		AIBaseURL:           strings.TrimSpace(os.Getenv("AI_BASE_URL")),
		AIAPIKey:            strings.TrimSpace(os.Getenv("AI_API_KEY")),
		AIModel:             getenv("AI_MODEL", ""),
		PublicBaseURL:       strings.TrimRight(getenv("PUBLIC_BASE_URL", "http://localhost:8080"), "/"),
		LogLevel:            getenv("LOG_LEVEL", "info"),
		SlowQueryThreshold:  duration("SLOW_QUERY_THRESHOLD", 500*time.Millisecond),
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL wajib diisi")
	}
	if c.Pepper == "" {
		return c, fmt.Errorf("AUTH_PEPPER wajib diisi dan harus sama dengan Script Properties PEPPER pada Apps Script")
	}
	if _, err := time.LoadLocation(c.Timezone); err != nil {
		return c, fmt.Errorf("timezone tidak valid: %w", err)
	}
	return c, nil
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func boolenv(k string, d bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(k)))
	if v == "" {
		return d
	}
	return v == "1" || v == "true" || v == "yes" || v == "ya"
}
func intenv(k string, d int) int {
	v := os.Getenv(k)
	if v == "" {
		return d
	}
	n, e := strconv.Atoi(v)
	if e != nil {
		return d
	}
	return n
}
func duration(k string, d time.Duration) time.Duration {
	v := os.Getenv(k)
	if v == "" {
		return d
	}
	x, e := time.ParseDuration(v)
	if e != nil {
		return d
	}
	return x
}
