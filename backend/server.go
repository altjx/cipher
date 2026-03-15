package main

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog"
)

type Server struct {
	router   *mux.Router
	handlers *Handlers
	hub      *WSHub
	logger   zerolog.Logger
}

func NewServer(handlers *Handlers, hub *WSHub, logger zerolog.Logger) *Server {
	s := &Server{
		router:   mux.NewRouter(),
		handlers: handlers,
		hub:      hub,
		logger:   logger.With().Str("component", "server").Logger(),
	}
	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	// CORS middleware
	s.router.Use(s.corsMiddleware)

	// Status & Pairing
	s.router.HandleFunc("/api/status", s.handlers.GetStatus).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/pair", s.handlers.StartPairing).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/unpair", s.handlers.Unpair).Methods("POST", "OPTIONS")

	// Conversations
	s.router.HandleFunc("/api/conversations", s.handlers.ListConversations).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/messages", s.handlers.GetMessages).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/conversations/{id}/media", s.handlers.GetConversationMedia).Methods("GET", "OPTIONS")

	// Messaging
	s.router.HandleFunc("/api/messages", s.handlers.SendMessage).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/messages/media", s.handlers.SendMedia).Methods("POST", "OPTIONS")
	s.router.HandleFunc("/api/media", s.handlers.GetMedia).Methods("GET", "OPTIONS")
	s.router.HandleFunc("/api/media/full-size", s.handlers.RequestFullSizeImage).Methods("POST", "OPTIONS")

	// Reactions
	s.router.HandleFunc("/api/reactions", s.handlers.SendReaction).Methods("POST", "OPTIONS")

	// Read Receipts
	s.router.HandleFunc("/api/mark-read", s.handlers.MarkRead).Methods("POST", "OPTIONS")

	// Search
	s.router.HandleFunc("/api/search", s.handlers.SearchMessages).Methods("GET", "OPTIONS")

	// Contacts
	s.router.HandleFunc("/api/contacts", s.handlers.ListContacts).Methods("GET", "OPTIONS")

	// WebSocket
	s.router.HandleFunc("/ws", s.hub.HandleWS)
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		allowedOrigins := map[string]bool{
			"http://localhost:5173": true,
			"http://localhost:8080": true,
		}

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

func (s *Server) Handler() http.Handler {
	return s.router
}
