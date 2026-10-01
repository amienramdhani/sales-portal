package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"salesportal/internal/config"
	"salesportal/internal/importer"
	"sort"
	"time"
)

func main() {
	schema := flag.String("schema", "/app/migrations", "SQL migration file or directory")
	xlsx := flag.String("xlsx", "", "database XLSX awal")
	flag.Parse()
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		panic(err)
	}
	defer pool.Close()
	files := []string{}
	st, err := os.Stat(*schema)
	if err != nil {
		panic(err)
	}
	if st.IsDir() {
		matches, err := filepath.Glob(filepath.Join(*schema, "*.sql"))
		if err != nil {
			panic(err)
		}
		sort.Strings(matches)
		files = matches
	} else {
		files = []string{*schema}
	}
	if len(files) == 0 {
		panic("tidak ada migration SQL")
	}
	for _, file := range files {
		sql, err := os.ReadFile(file)
		if err != nil {
			panic(err)
		}
		if _, err = pool.Exec(ctx, string(sql)); err != nil {
			panic(fmt.Errorf("migration %s: %w", filepath.Base(file), err))
		}
		fmt.Println("migration OK:", filepath.Base(file))
	}
	if *xlsx != "" {
		loc, _ := time.LoadLocation(cfg.Timezone)
		im := &importer.Importer{DB: pool, Location: loc}
		counts, err := im.ImportInitialWorkbook(ctx, *xlsx)
		if err != nil {
			panic(err)
		}
		fmt.Println("import OK")
		for k, v := range counts {
			fmt.Printf("  %-30s %d\n", k, v)
		}
	}
}
