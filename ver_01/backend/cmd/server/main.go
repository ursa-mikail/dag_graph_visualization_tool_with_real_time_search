package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/dagviz/backend/internal/db"
	"github.com/dagviz/backend/internal/handlers"
	ws "github.com/dagviz/backend/internal/websocket"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

func main() {
	ctx := context.Background()

	// Config from env
	dsn := getEnv("DATABASE_URL", "postgres://dagviz:dagviz_secret@localhost:5432/dagviz?sslmode=disable")
	port := getEnv("PORT", "8080")
	domain := getEnv("DOMAIN", "laundering")
	simIntervalMs, _ := strconv.Atoi(getEnv("SIM_INTERVAL_MS", "2000"))

	log.Printf("DAGViz Backend starting — domain=%s port=%s", domain, port)

	// Database
	database, err := db.New(ctx, dsn)
	if err != nil {
		log.Fatalf("DB connection failed: %v", err)
	}
	defer database.Close()

	// WebSocket hub
	hub := ws.NewHub()
	go hub.Run()

	// HTTP handlers
	h := handlers.New(database, hub, domain)

	// Simulator
	sim := handlers.NewSimulator(database, hub, domain, simIntervalMs)
	go sim.Start(ctx)

	// Router
	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/health", h.Health).Methods("GET")
	api.HandleFunc("/graph", h.GetGraph).Methods("GET")
	api.HandleFunc("/nodes/{id}/neighbors", h.GetNeighbors).Methods("GET")
	api.HandleFunc("/search", h.Search).Methods("GET")
	api.HandleFunc("/schema", h.GetSchema).Methods("GET")
	api.HandleFunc("/tables", h.GetTables).Methods("GET")
	api.HandleFunc("/node-types", h.GetNodeTypes).Methods("GET")
	api.HandleFunc("/alerts", h.GetAlerts).Methods("GET")
	api.HandleFunc("/export/csv", h.ExportCSV).Methods("GET")
	api.HandleFunc("/import/csv", h.ImportCSV).Methods("POST")

	// WebSocket
	r.HandleFunc("/ws", hub.ServeWS)

	// CORS
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: false,
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      c.Handler(r),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("Listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
