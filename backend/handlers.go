package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"os/exec"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

type Handlers struct {
	client *GMClient
	db     *Database
}

func NewHandlers(client *GMClient, db *Database) *Handlers {
	return &Handlers{client: client, db: db}
}

// GetStatus returns the current connection status.
// GET /api/status
func (h *Handlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	resp := StatusResponse{
		Status:     string(h.client.Status()),
		PhoneModel: h.client.PhoneModel(),
	}
	writeJSON(w, http.StatusOK, resp)
}

// StartPairing initiates QR code pairing.
// GET /api/pair
func (h *Handlers) StartPairing(w http.ResponseWriter, r *http.Request) {
	qrURL, err := h.client.StartPairing()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to start pairing: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, PairResponse{QRUrl: qrURL})
}

// StartGaiaPairing initiates Google Account pairing.
// POST /api/pair/google
func (h *Handlers) StartGaiaPairing(w http.ResponseWriter, r *http.Request) {
	var req GaiaPairRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(req.Cookies) == 0 {
		writeError(w, http.StatusBadRequest, "cookies are required")
		return
	}

	emoji, emojiURL, err := h.client.StartGaiaPairing(req.Cookies)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to start Google pairing: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, GaiaPairResponse{Emoji: emoji, EmojiURL: emojiURL})
}

// Reconnect forces a full reconnect of the libgm client.
// POST /api/reconnect
func (h *Handlers) Reconnect(w http.ResponseWriter, r *http.Request) {
	if err := h.client.Reconnect(); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to reconnect: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, StatusResponse{
		Status:     string(h.client.Status()),
		PhoneModel: h.client.PhoneModel(),
	})
}

// Unpair disconnects and deletes the session.
// POST /api/unpair
func (h *Handlers) Unpair(w http.ResponseWriter, r *http.Request) {
	if err := h.client.Unpair(); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to unpair: "+err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteConversation deletes a conversation.
// DELETE /api/conversations/:id
func (h *Handlers) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	conversationID := vars["id"]

	if err := h.client.DeleteConversation(conversationID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete conversation: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListConversations returns conversations.
// GET /api/conversations
func (h *Handlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	limit := queryParamInt(r, "limit", 50)
	folder := r.URL.Query().Get("folder")
	if folder == "" {
		folder = "inbox"
	}

	convs, err := h.client.ListConversations(limit, folder)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to list conversations: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, ConversationListResponse{Conversations: convs})
}

// GetMessages returns messages for a conversation.
// GET /api/conversations/:id/messages
func (h *Handlers) GetMessages(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	conversationID := vars["id"]

	limit := queryParamInt(r, "limit", 50)
	cursor := r.URL.Query().Get("cursor")

	msgs, nextCursor, err := h.client.FetchMessages(conversationID, limit, cursor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get messages: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, MessageListResponse{
		Messages:   msgs,
		NextCursor: nextCursor,
	})
}

// SendMessage sends a text message.
// POST /api/messages
func (h *Handlers) SendMessage(w http.ResponseWriter, r *http.Request) {
	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ConversationID == "" || req.Text == "" {
		writeError(w, http.StatusBadRequest, "conversationId and text are required")
		return
	}

	resp, err := h.client.SendMessage(req.ConversationID, req.Text, req.ReplyToID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to send message: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// allowedMediaTypes contains MIME type prefixes accepted for media uploads.
var allowedMediaTypes = []string{
	"image/",
	"video/",
	"audio/",
	"application/pdf",
	"text/vcard",
	"text/x-vcard",
}

// isAllowedMediaType checks if the MIME type is in the allowed list.
func isAllowedMediaType(mimeType string) bool {
	for _, allowed := range allowedMediaTypes {
		if strings.HasPrefix(mimeType, allowed) || mimeType == allowed {
			return true
		}
	}
	return false
}

// SendMedia sends a media message (single or multiple files).
// POST /api/messages/media
func (h *Handlers) SendMedia(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(20 << 20); err != nil { // 20 MB max
		writeError(w, http.StatusBadRequest, "Failed to parse multipart form")
		return
	}

	conversationID := r.FormValue("conversationId")
	replyToID := r.FormValue("replyToId")

	if conversationID == "" {
		writeError(w, http.StatusBadRequest, "conversationId is required")
		return
	}

	// Check for multiple files under "files" key first, then fall back to single "file"
	multiFiles := r.MultipartForm.File["files"]
	if len(multiFiles) > 1 {
		// Multi-file path
		var files []MediaFile
		for _, fh := range multiFiles {
			mimeType := fh.Header.Get("Content-Type")
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}
			if !isAllowedMediaType(mimeType) {
				writeError(w, http.StatusBadRequest, "File type not allowed: "+mimeType)
				return
			}
			f, err := fh.Open()
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to open file: "+fh.Filename)
				return
			}
			data, err := io.ReadAll(f)
			f.Close()
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to read file: "+fh.Filename)
				return
			}
			files = append(files, MediaFile{Data: data, FileName: fh.Filename, MimeType: mimeType})
		}

		resp, err := h.client.SendMultiMedia(conversationID, files, replyToID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to send media: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// Single file path (backward compatible with "file" or single "files")
	var file io.ReadCloser
	var header *multipart.FileHeader
	var err error

	if len(multiFiles) == 1 {
		file, err = multiFiles[0].Open()
		header = multiFiles[0]
	} else {
		file, header, err = r.FormFile("file")
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	fileData, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to read file")
		return
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if !isAllowedMediaType(mimeType) {
		writeError(w, http.StatusBadRequest, "File type not allowed: "+mimeType)
		return
	}

	resp, err := h.client.SendMedia(conversationID, fileData, header.Filename, mimeType, replyToID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to send media: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// GetMedia downloads decrypted media.
// GET /api/media?messageId=...&mediaId=...
func (h *Handlers) GetMedia(w http.ResponseWriter, r *http.Request) {
	messageID := r.URL.Query().Get("messageId")
	mediaID := r.URL.Query().Get("mediaId")

	if messageID == "" || mediaID == "" {
		writeError(w, http.StatusBadRequest, "messageId and mediaId query parameters are required")
		return
	}

	data, mimeType, err := h.client.DownloadMedia(messageID, mediaID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Failed to download media: "+err.Error())
		return
	}

	// Transcode non-browser-friendly audio formats to OGG Opus via ffmpeg
	if strings.HasPrefix(mimeType, "audio/") && !isBrowserAudio(mimeType) {
		transcoded, err := transcodeAudioToOgg(data)
		if err == nil {
			data = transcoded
			mimeType = "audio/ogg"
		}
		// If transcoding fails, serve the original and let the client handle it
	}

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// isBrowserAudio returns true for audio formats that browsers can natively decode.
func isBrowserAudio(mime string) bool {
	switch mime {
	case "audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/webm",
		"audio/aac", "audio/mp4", "audio/flac":
		return true
	}
	return false
}

// transcodeAudioToOgg converts audio data to OGG Opus using ffmpeg.
func transcodeAudioToOgg(input []byte) ([]byte, error) {
	cmd := exec.Command("ffmpeg",
		"-i", "pipe:0", // read from stdin
		"-c:a", "libopus",
		"-b:a", "64k",
		"-f", "ogg",
		"-y",          // overwrite
		"pipe:1",      // write to stdout
	)
	cmd.Stdin = bytes.NewReader(input)
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// RequestFullSizeImage asks Google to make a full-resolution image available.
// POST /api/media/full-size
func (h *Handlers) RequestFullSizeImage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MessageID       string `json:"messageId"`
		ActionMessageID string `json:"actionMessageId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.MessageID == "" || req.ActionMessageID == "" {
		writeError(w, http.StatusBadRequest, "messageId and actionMessageId are required")
		return
	}

	if err := h.client.RequestFullSizeImage(req.MessageID, req.ActionMessageID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to request full-size image: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// SendReaction sends or removes a reaction.
// POST /api/reactions
func (h *Handlers) SendReaction(w http.ResponseWriter, r *http.Request) {
	var req SendReactionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ConversationID == "" || req.MessageID == "" {
		writeError(w, http.StatusBadRequest, "conversationId and messageId are required")
		return
	}

	if err := h.client.SendReaction(req.ConversationID, req.MessageID, req.Emoji); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to send reaction: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// MarkRead marks a conversation as read.
// POST /api/mark-read
func (h *Handlers) MarkRead(w http.ResponseWriter, r *http.Request) {
	var req MarkReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ConversationID == "" || req.MessageID == "" {
		writeError(w, http.StatusBadRequest, "conversationId and messageId are required")
		return
	}

	// Always clear unread locally and broadcast to all WS clients
	h.client.MarkReadLocal(req.ConversationID)

	// Only send read receipt to the remote side if requested (default: true)
	sendReceipt := req.SendReceipt == nil || *req.SendReceipt
	if sendReceipt {
		if err := h.client.MarkRead(req.ConversationID, req.MessageID); err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to mark read: "+err.Error())
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// CreateConversation creates a new conversation with given phone numbers.
// POST /api/conversations
func (h *Handlers) CreateConversation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Numbers []string `json:"numbers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if len(req.Numbers) == 0 {
		writeError(w, http.StatusBadRequest, "At least one phone number is required")
		return
	}

	conv, err := h.client.CreateConversation(req.Numbers)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create conversation: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, conv)
}

// GetConversationDetails returns full details for a conversation.
// GET /api/conversations/:id/details
func (h *Handlers) GetConversationDetails(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	conversationID := vars["id"]

	conv, err := h.client.GetConversationDetails(conversationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get conversation details: "+err.Error())
		return
	}
	if conv == nil {
		writeError(w, http.StatusNotFound, "Conversation not found")
		return
	}

	writeJSON(w, http.StatusOK, conv)
}

// ArchiveConversation archives or unarchives a conversation.
// POST /api/conversations/:id/archive
func (h *Handlers) ArchiveConversation(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	conversationID := vars["id"]

	var req struct {
		Archive bool `json:"archive"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := h.client.ArchiveConversation(conversationID, req.Archive); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to archive conversation: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// MuteConversation mutes or unmutes a conversation.
// POST /api/conversations/:id/mute
func (h *Handlers) MuteConversation(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	conversationID := vars["id"]

	var req struct {
		Mute bool `json:"mute"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := h.client.MuteConversation(conversationID, req.Mute); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to mute conversation: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// BlockConversation blocks or unblocks a conversation.
// POST /api/conversations/:id/block
func (h *Handlers) BlockConversation(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	conversationID := vars["id"]

	var req struct {
		Block bool `json:"block"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := h.client.BlockConversation(conversationID, req.Block); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to block conversation: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeleteMessage deletes a single message.
// DELETE /api/messages/:id
func (h *Handlers) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	messageID := vars["id"]

	if err := h.client.DeleteMessage(messageID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete message: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetParticipantThumbnail returns an avatar image for a participant.
// GET /api/avatars/:id
func (h *Handlers) GetParticipantThumbnail(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	participantID := vars["id"]

	thumbnails, err := h.client.GetParticipantThumbnails([]string{participantID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get thumbnail: "+err.Error())
		return
	}

	data, ok := thumbnails[participantID]
	if !ok || len(data) == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// SetTyping sends a typing indicator for a conversation.
// POST /api/typing
func (h *Handlers) SetTyping(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConversationID string `json:"conversationId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ConversationID == "" {
		writeError(w, http.StatusBadRequest, "conversationId is required")
		return
	}

	if err := h.client.SetTyping(req.ConversationID); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to send typing indicator: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListContacts returns the contact list.
// GET /api/contacts
func (h *Handlers) ListContacts(w http.ResponseWriter, r *http.Request) {
	contacts, err := h.client.ListContacts()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to list contacts: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, ContactListResponse{Contacts: contacts})
}

// SearchContacts searches the phone's full contact list by name.
// GET /api/contacts/search?q=...
func (h *Handlers) SearchContacts(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeJSON(w, http.StatusOK, ContactListResponse{Contacts: []ContactResponse{}})
		return
	}

	contacts, err := h.client.SearchContacts(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to search contacts: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, ContactListResponse{Contacts: contacts})
}

// SearchMessages searches message content.
// GET /api/search
func (h *Handlers) SearchMessages(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, SearchResponse{Results: []SearchResult{}})
		return
	}
	limit := queryParamInt(r, "limit", 50)
	results, err := h.db.SearchMessages(q, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Search failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, SearchResponse{Results: results})
}

// GetConversationMedia returns messages with media for a conversation.
// GET /api/conversations/:id/media
func (h *Handlers) GetConversationMedia(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	conversationID := vars["id"]

	limit := queryParamInt(r, "limit", 30)
	cursor := r.URL.Query().Get("cursor")

	// Ensure messages are cached by fetching fresh from the live client first.
	// This prevents a race where the detail panel queries the DB before the
	// message thread's fetch has populated the cache.
	if h.client.GetClient() != nil {
		_, _, _ = h.client.FetchMessagesFresh(conversationID, 50, "")
	}

	msgs, nextCursor, err := h.db.GetMediaMessages(conversationID, limit, cursor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get media messages: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, MessageListResponse{
		Messages:   msgs,
		NextCursor: nextCursor,
	})
}

// Helpers

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func queryParamInt(r *http.Request, key string, defaultVal int) int {
	val := r.URL.Query().Get(key)
	if val == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return n
}
