package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/util"
)

func init() {
	util.BrowserDetailsMessage.OS = "Cipher for Mac"
}

func main() {
	port := flag.Int("port", 8080, "HTTP server port")
	dataDir := flag.String("data", "./data", "Data directory for session and database files")
	frontendDir := flag.String("frontend", "", "Directory containing frontend static files to serve")
	flag.Parse()

	// Set up zerolog — write to both stderr and a log file for diagnostics
	consoleWriter := zerolog.ConsoleWriter{Out: os.Stderr}

	// Ensure data directory exists before opening log file
	if err := os.MkdirAll(*dataDir, 0700); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create data directory: %v\n", err)
		os.Exit(1)
	}

	logFilePath := filepath.Join(*dataDir, "diagnostic.log")
	logFile, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: failed to open log file %s: %v\n", logFilePath, err)
		// Fall back to console-only logging
		logFile = nil
	}

	var logWriter io.Writer
	if logFile != nil {
		logWriter = io.MultiWriter(consoleWriter, logFile)
	} else {
		logWriter = consoleWriter
	}

	logger := zerolog.New(logWriter).
		With().
		Timestamp().
		Logger()

	logger.Info().Str("log_file", logFilePath).Msg("Diagnostic logging enabled")

	// Initialize database
	dbPath := filepath.Join(*dataDir, "messages.db")
	db, err := NewDatabase(dbPath, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to initialize database")
	}
	defer db.Close()

	// Initialize WebSocket hub
	hub := NewWSHub(logger, *port)

	// Initialize client
	gmClient := NewGMClient(*dataDir, logger, hub, db)

	// Try to restore existing session
	if err := gmClient.Init(); err != nil {
		logger.Error().Err(err).Msg("Failed to initialize client")
	}

	// Set up HTTP handlers and server
	handlers := NewHandlers(gmClient, db)
	server := NewServer(handlers, hub, logger, *frontendDir, *port)

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	logger.Info().Str("addr", addr).Msg("Starting HTTP server")

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		logger.Info().Str("signal", sig.String()).Msg("Shutting down")

		gmClient.StopHealthCheck()
		if cli := gmClient.GetClient(); cli != nil {
			cli.Disconnect()
		}
		db.Close()
		if logFile != nil {
			logFile.Close()
		}
		os.Exit(0)
	}()

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := httpServer.ListenAndServe(); err != nil {
		logger.Fatal().Err(err).Msg("Server failed")
	}
}
