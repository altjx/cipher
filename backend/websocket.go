package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

// newUpgrader creates a WebSocket upgrader that only allows localhost origins.
func newUpgrader(port int) websocket.Upgrader {
	allowedOrigins := map[string]bool{
		"http://localhost:5173":                          true,
		fmt.Sprintf("http://localhost:%d", port):         true,
		"http://127.0.0.1:5173":                         true,
		fmt.Sprintf("http://127.0.0.1:%d", port):        true,
	}
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			// Allow no-origin requests (e.g. from Electron main process)
			if origin == "" {
				return true
			}
			return allowedOrigins[origin]
		},
	}
}

type WSHub struct {
	clients  map[*WSClient]bool
	mu       sync.RWMutex
	logger   zerolog.Logger
	upgrader websocket.Upgrader
}

type WSClient struct {
	conn *websocket.Conn
	send chan []byte
}

func NewWSHub(logger zerolog.Logger, port int) *WSHub {
	return &WSHub{
		clients:  make(map[*WSClient]bool),
		logger:   logger.With().Str("component", "websocket").Logger(),
		upgrader: newUpgrader(port),
	}
}

func (h *WSHub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to upgrade WebSocket connection")
		return
	}

	client := &WSClient{
		conn: conn,
		send: make(chan []byte, 256),
	}

	h.mu.Lock()
	h.clients[client] = true
	h.mu.Unlock()

	h.logger.Info().Msg("WebSocket client connected")

	go h.writePump(client)
	go h.readPump(client)
}

func (h *WSHub) readPump(client *WSClient) {
	defer func() {
		h.removeClient(client)
	}()
	for {
		_, _, err := client.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				h.logger.Warn().Err(err).Msg("WebSocket read error")
			}
			break
		}
		// We don't process incoming messages from the frontend currently
	}
}

func (h *WSHub) writePump(client *WSClient) {
	defer func() {
		client.conn.Close()
	}()
	for msg := range client.send {
		if err := client.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			h.logger.Warn().Err(err).Msg("WebSocket write error")
			return
		}
	}
}

func (h *WSHub) removeClient(client *WSClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[client]; ok {
		delete(h.clients, client)
		close(client.send)
		h.logger.Info().Msg("WebSocket client disconnected")
	}
}

func (h *WSHub) Broadcast(event WSEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to marshal WebSocket event")
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		select {
		case client.send <- data:
		default:
			// Client send buffer is full, drop it
			h.logger.Warn().Msg("Dropping slow WebSocket client")
			go h.removeClient(client)
		}
	}
}

func (h *WSHub) BroadcastNewMessage(msg MessageResponse) {
	h.Broadcast(WSEvent{Type: "new_message", Data: msg})
}

func (h *WSHub) BroadcastMessagesRefreshed(conversationID string, msgs []MessageResponse, nextCursor string) {
	h.Broadcast(WSEvent{Type: "messages_refreshed", Data: MessagesRefreshedData{
		ConversationID: conversationID,
		Messages:       msgs,
		NextCursor:     nextCursor,
	}})
}

func (h *WSHub) BroadcastMessageUpdate(msg MessageResponse) {
	h.Broadcast(WSEvent{Type: "message_update", Data: msg})
}

func (h *WSHub) BroadcastMessageStatus(messageID, conversationID, status string) {
	h.Broadcast(WSEvent{
		Type: "message_status",
		Data: MessageStatusData{
			MessageID:      messageID,
			ConversationID: conversationID,
			Status:         status,
		},
	})
}

func (h *WSHub) BroadcastConversationUpdate(conv ConversationResponse) {
	h.Broadcast(WSEvent{Type: "conversation_update", Data: conv})
}

func (h *WSHub) BroadcastConversationDeleted(conversationID string) {
	h.Broadcast(WSEvent{Type: "conversation_deleted", Data: ConversationDeletedData{ConversationID: conversationID}})
}

func (h *WSHub) BroadcastPhoneStatus(status string) {
	h.Broadcast(WSEvent{Type: "phone_status", Data: PhoneStatusData{Status: status}})
}

func (h *WSHub) BroadcastTyping(conversationID, participantID, name string, active bool) {
	h.Broadcast(WSEvent{
		Type: "typing",
		Data: TypingData{
			ConversationID: conversationID,
			ParticipantID:  participantID,
			Name:           name,
			Active:         active,
		},
	})
}

func (h *WSHub) BroadcastPairSuccess() {
	h.Broadcast(WSEvent{Type: "pair_success", Data: struct{}{}})
}

func (h *WSHub) BroadcastQRRefresh(qrURL string) {
	h.Broadcast(WSEvent{Type: "qr_refresh", Data: QRRefreshData{QRUrl: qrURL}})
}

func (h *WSHub) BroadcastSessionExpired() {
	h.Broadcast(WSEvent{Type: "session_expired", Data: struct{}{}})
}
