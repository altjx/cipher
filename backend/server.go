package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog"
)

type Server struct {
	router   *mux.Router
	handlers *Handlers
	hub      *WSHub
	logger   zerolog.Logger
	port     int
}

func NewServer(handlers *Handlers, hub *WSHub, logger zerolog.Logger, frontendDir string, port int) *Server {
	s := &Server{
		router:   mux.NewRouter(),
		handlers: handlers,
		hub:      hub,
		logger:   logger.With().Str("component", "server").Logger(),
		port:     port,
	}
	s.setupRoutes()

	// Serve frontend static files if a directory is provided
	if frontendDir != "" {
		s.logger.Info().Str("dir", frontendDir).Msg("Serving frontend static files")
		fs := http.FileServer(http.Dir(frontendDir))
		s.router.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// If the file exists, serve it; otherwise serve index.html (SPA fallback)
			path := filepath.Join(frontendDir, r.URL.Path)
			if _, err := os.Stat(path); os.IsNotExist(err) {
				http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
				return
			}
			fs.ServeHTTP(w, r)
		})
	}

	return s
}

func (s *Server) setupRoutes() {
	// Security headers middleware
	s.router.Use(s.securityHeadersMiddleware)
	// CORS middleware
	s.router.Use(s.corsMiddleware)

	// Status & Pairing
	s.router.HandleFunc("/api/status", s.handlers.GetStatus).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/pair", s.handlers.StartPairing).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/pair/google", s.handlers.StartGaiaPairing).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/reconnect", s.handlers.Reconnect).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/unpair", s.handlers.Unpair).Methods("POST", "OPTIONS")

	// Conversations
	s.router.HandleFunc("/api/conversations", s.handlers.ListConversations).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/conversations", s.handlers.CreateConversation).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}", s.handlers.DeleteConversation).Methods("DELETE", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/messages", s.handlers.GetMessages).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/media", s.handlers.GetConversationMedia).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/details", s.handlers.GetConversationDetails).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/archive", s.handlers.ArchiveConversation).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/mute", s.handlers.MuteConversation).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/block", s.handlers.BlockConversation).Methods("POST", "OPTIONS")

	// Messaging
	s.router.HandleFunc("/api/messages", s.handlers.SendMessage).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/messages/media", s.handlers.SendMedia).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/messages/{id}", s.handlers.DeleteMessage).Methods("DELETE", "OPTIONS")
	s.router.HandleFunc("/api/media", s.handlers.GetMedia).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/media/full-size", s.handlers.RequestFullSizeImage).Methods("POST", "OPTIONS")

	// Reactions
	s.router.HandleFunc("/api/reactions", s.handlers.SendReaction).Methods("POST", "OPTIONS")

	// Typing Indicators
	s.router.HandleFunc("/api/typing", s.handlers.SetTyping).Methods("POST", "OPTIONS")

	// Read Receipts
	s.router.HandleFunc("/api/mark-read", s.handlers.MarkRead).Methods("POST", "OPTIONS")

	// Search
	s.router.HandleFunc("/api/search", s.handlers.SearchMessages).Methods("GET", "OPTIONS")

	// Contacts
	s.router.HandleFunc("/api/contacts", s.handlers.ListContacts).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/contacts/search", s.handlers.SearchContacts).Methods("GET", "OPTIONS")

	// Link Previews
	s.router.HandleFunc("/api/link-preview", s.handlers.GetLinkPreview).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/link-preview/image", s.handlers.ProxyImage).Methods("GET", "OPTIONS")

	// Avatars
	s.router.HandleFunc("/api/avatars/{id}", s.handlers.GetParticipantThumbnail).Methods("GET", "OPTIONS")

	// WebSocket
	s.router.HandleFunc("/ws", s.hub.HandleWS)
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	allowedOrigins := map[string]bool{
		"http://localhost:5173":                          true,
		fmt.Sprintf("http://localhost:%d", s.port):       true,
		"http://127.0.0.1:5173":                         true,
		fmt.Sprintf("http://127.0.0.1:%d", s.port):      true,
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) Handler() http.Handler {
	return s.router
}
