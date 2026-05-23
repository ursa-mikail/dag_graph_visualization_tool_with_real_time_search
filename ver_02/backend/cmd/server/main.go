package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/dagviz-netflow/backend/internal/db"
	"github.com/dagviz-netflow/backend/internal/handlers"
	ws "github.com/dagviz-netflow/backend/internal/websocket"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

func main() {
	ctx := context.Background()

	dsn  := getEnv("DATABASE_URL", "postgres://netflow:netflow_secret@localhost:5432/netflow?sslmode=disable")
	port := getEnv("PORT", "8080")

	log.Printf("NetFlow DAG — starting on :%s", port)

	database, err := db.New(ctx, dsn)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer database.Close()

	hub := ws.NewHub()
	go hub.Run()

	h := handlers.New(database, hub)

	r := mux.NewRouter()
	api := r.PathPrefix("/api").Subrouter()

	api.HandleFunc("/health",        h.Health).Methods("GET")
	api.HandleFunc("/timerange",     h.GetTimeRange).Methods("GET")
	api.HandleFunc("/snapshot",      h.GetSnapshot).Methods("GET")
	api.HandleFunc("/events",        h.GetEvents).Methods("GET")
	api.HandleFunc("/systems",       h.GetSystems).Methods("GET")
	api.HandleFunc("/systems/{id}",  h.GetSystem).Methods("GET")
	api.HandleFunc("/search",        h.Search).Methods("GET")
	api.HandleFunc("/filters/values",h.GetFilterValues).Methods("GET")
	api.HandleFunc("/import/csv",    h.ImportCSV).Methods("POST")
	api.HandleFunc("/export/csv",    h.ExportCSV).Methods("GET")
	api.HandleFunc("/data",          h.ClearData).Methods("DELETE")

	r.HandleFunc("/ws", hub.ServeWS)

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      c.Handler(r),
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("Listening on :%s", port)
	log.Fatal(srv.ListenAndServe())
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
