package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/rs/zerolog"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/util"
)

func init() {
	util.BrowserDetailsMessage.OS = "Android Messages for Mac"
}

func main() {
	port := flag.Int("port", 8080, "HTTP server port")
	dataDir := flag.String("data", "./data", "Data directory for session and database files")
	frontendDir := flag.String("frontend", "", "Directory containing frontend static files to serve")
	flag.Parse()

	// Set up zerolog
	logger := zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr}).
		With().
		Timestamp().
		Logger()

	// Ensure data directory exists
	if err := os.MkdirAll(*dataDir, 0700); err != nil {
		logger.Fatal().Err(err).Msg("Failed to create data directory")
	}

	// Initialize database
	dbPath := filepath.Join(*dataDir, "messages.db")
	db, err := NewDatabase(dbPath, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to initialize database")
	}
	defer db.Close()

	// Initialize WebSocket hub
	hub := NewWSHub(logger)

	// Initialize Google Messages client
	gmClient := NewGMClient(*dataDir, logger, hub, db)

	// Try to restore existing session
	if err := gmClient.Init(); err != nil {
		logger.Error().Err(err).Msg("Failed to initialize client")
	}

	// Set up HTTP handlers and server
	handlers := NewHandlers(gmClient, db)
	server := NewServer(handlers, hub, logger, *frontendDir)

	addr := fmt.Sprintf(":%d", *port)
	logger.Info().Str("addr", addr).Msg("Starting HTTP server")

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		logger.Info().Str("signal", sig.String()).Msg("Shutting down")

		if cli := gmClient.GetClient(); cli != nil {
			cli.Disconnect()
		}
		db.Close()
		os.Exit(0)
	}()

	if err := http.ListenAndServe(addr, server.Handler()); err != nil {
		logger.Fatal().Err(err).Msg("Server failed")
	}
}
