package main

import (
	"flag"
	"fmt"
	"io"
	"net"
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
	port := flag.Int("port", 0, "HTTP server port (0 for random available port)")
	dataDir := flag.String("data", "./data", "Data directory for session and database files")
	frontendDir := flag.String("frontend", "", "Directory containing frontend static files to serve")
	demo := flag.Bool("demo", false, "Run in demo mode (fake paired status, serve from cache only)")
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

	// Bind listener early so we know the actual port (supports --port 0 for random)
	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		logger.Fatal().Err(err).Str("addr", addr).Msg("Failed to bind listener")
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port

	// Print machine-readable port for the Electron parent process to parse
	fmt.Fprintf(os.Stdout, "LISTENING_PORT=%d\n", actualPort)

	// Initialize WebSocket hub
	hub := NewWSHub(logger, actualPort)

	// Initialize client
	gmClient := NewGMClient(*dataDir, logger, hub, db)

	if *demo {
		gmClient.SetStatus(StatusPaired)
		hub.SetDemo(true)
		logger.Info().Msg("Running in demo mode — status forced to paired, serving from cache only")
	} else {
		// Try to restore existing session
		if err := gmClient.Init(); err != nil {
			logger.Error().Err(err).Msg("Failed to initialize client")
		}
	}

	// Set up HTTP handlers and server
	handlers := NewHandlers(gmClient, db)
	server := NewServer(handlers, hub, logger, *frontendDir, actualPort)

	logger.Info().Str("addr", listener.Addr().String()).Msg("Starting HTTP server")

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
		Handler:           server.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := httpServer.Serve(listener); err != nil {
		logger.Fatal().Err(err).Msg("Server failed")
	}
}
