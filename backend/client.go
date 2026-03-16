package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/mautrix-gmessages/pkg/libgm"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
)

type ConnectionStatus string

const (
	StatusUnpaired     ConnectionStatus = "unpaired"
	StatusConnecting   ConnectionStatus = "connecting"
	StatusPaired       ConnectionStatus = "paired"
	StatusPhoneOffline ConnectionStatus = "phone_offline"
)

// SessionData stores auth data and push keys for persistence.
type SessionData struct {
	AuthData *libgm.AuthData `json:"authData"`
	PushKeys *libgm.PushKeys `json:"pushKeys,omitempty"`
}

// convMeta caches per-conversation data needed for sending messages.
type convMeta struct {
	outgoingID string
	simPayload *gmproto.SIMPayload
}

type GMClient struct {
	client     *libgm.Client
	mu         sync.RWMutex
	status     atomic.Value // stores ConnectionStatus
	phoneModel string

	dataDir     string
	sessionFile string
	logger      zerolog.Logger
	hub         *WSHub
	db          *Database

	// Per-conversation outgoing participant ID and SIM payload
	convMetaMu sync.RWMutex
	convMetas  map[string]*convMeta

	// QR pairing control
	pairingCancel chan struct{}
	pairingMu     sync.Mutex
}

func NewGMClient(dataDir string, logger zerolog.Logger, hub *WSHub, db *Database) *GMClient {
	c := &GMClient{
		dataDir:     dataDir,
		sessionFile: filepath.Join(dataDir, "session.json"),
		logger:      logger.With().Str("component", "client").Logger(),
		hub:         hub,
		db:          db,
		convMetas:   make(map[string]*convMeta),
	}
	c.status.Store(StatusUnpaired)
	return c
}

// cacheConvMeta extracts and caches the outgoing participant ID and SIM payload
// from a raw gmproto.Conversation.
func (c *GMClient) cacheConvMeta(conv *gmproto.Conversation) {
	convID := conv.GetConversationID()
	outgoingID := conv.GetDefaultOutgoingID()

	var simPayload *gmproto.SIMPayload
	for _, p := range conv.GetParticipants() {
		if p.GetIsMe() {
			simPayload = p.GetSimPayload()
			if outgoingID == "" {
				if id := p.GetID(); id != nil {
					outgoingID = id.GetParticipantID()
				}
			}
			break
		}
	}

	if outgoingID == "" {
		return
	}

	c.convMetaMu.Lock()
	c.convMetas[convID] = &convMeta{
		outgoingID: outgoingID,
		simPayload: simPayload,
	}
	c.convMetaMu.Unlock()
}

func (c *GMClient) getConvMeta(conversationID string) *convMeta {
	c.convMetaMu.RLock()
	defer c.convMetaMu.RUnlock()
	return c.convMetas[conversationID]
}

func (c *GMClient) Status() ConnectionStatus {
	return c.status.Load().(ConnectionStatus)
}

func (c *GMClient) PhoneModel() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.phoneModel
}

func (c *GMClient) GetClient() *libgm.Client {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.client
}

// Init checks for an existing session and connects if found.
func (c *GMClient) Init() error {
	sess, err := c.loadSession()
	if err != nil {
		c.logger.Warn().Err(err).Msg("Failed to load session, starting fresh")
		return nil
	}
	if sess == nil {
		c.logger.Info().Msg("No existing session found")
		return nil
	}

	c.logger.Info().Msg("Restoring saved session")
	c.status.Store(StatusConnecting)

	cli := libgm.NewClient(sess.AuthData, sess.PushKeys, c.logger)
	cli.SetEventHandler(c.handleEvent)

	c.mu.Lock()
	c.client = cli
	c.mu.Unlock()

	if err := cli.Connect(); err != nil {
		c.logger.Error().Err(err).Msg("Failed to connect with saved session")
		c.status.Store(StatusUnpaired)
		return nil
	}

	return nil
}

// StartPairing begins the QR code pairing flow.
func (c *GMClient) StartPairing() (string, error) {
	c.pairingMu.Lock()
	// Cancel any existing pairing loop
	if c.pairingCancel != nil {
		close(c.pairingCancel)
	}
	c.pairingCancel = make(chan struct{})
	cancel := c.pairingCancel
	c.pairingMu.Unlock()

	c.status.Store(StatusConnecting)

	authData := libgm.NewAuthData()
	cli := libgm.NewClient(authData, nil, c.logger)
	cli.SetEventHandler(c.handleEvent)

	c.mu.Lock()
	c.client = cli
	c.mu.Unlock()

	qrURL, err := cli.StartLogin()
	if err != nil {
		c.status.Store(StatusUnpaired)
		return "", fmt.Errorf("failed to start login: %w", err)
	}

	// Start QR refresh goroutine
	go c.qrRefreshLoop(cli, cancel)

	return qrURL, nil
}

func (c *GMClient) qrRefreshLoop(cli *libgm.Client, cancel chan struct{}) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for i := 0; i < 5; i++ {
		select {
		case <-cancel:
			return
		case <-ticker.C:
			newURL, err := cli.RefreshPhoneRelay()
			if err != nil {
				c.logger.Error().Err(err).Msg("Failed to refresh QR code")
				return
			}
			c.logger.Info().Msg("QR code refreshed")
			c.hub.BroadcastQRRefresh(newURL)
		}
	}

	c.logger.Warn().Msg("QR refresh loop exhausted, pairing timed out")
	c.status.Store(StatusUnpaired)
}

// Unpair disconnects and deletes the session.
func (c *GMClient) Unpair() error {
	c.mu.Lock()
	cli := c.client
	c.client = nil
	c.mu.Unlock()

	if cli != nil {
		_ = cli.Unpair()
		cli.Disconnect()
	}

	c.status.Store(StatusUnpaired)
	c.phoneModel = ""

	// Remove session file
	if err := os.Remove(c.sessionFile); err != nil && !os.IsNotExist(err) {
		c.logger.Warn().Err(err).Msg("Failed to remove session file")
	}

	return nil
}

// Reconnect attempts to reconnect the client.
func (c *GMClient) Reconnect() error {
	cli := c.GetClient()
	if cli == nil {
		return fmt.Errorf("no client available")
	}
	return cli.Reconnect()
}

func (c *GMClient) saveSession() error {
	cli := c.GetClient()
	if cli == nil {
		return fmt.Errorf("no client to save session for")
	}

	sess := &SessionData{
		AuthData: cli.AuthData,
		PushKeys: cli.PushKeys,
	}

	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}

	if err := os.MkdirAll(c.dataDir, 0700); err != nil {
		return fmt.Errorf("failed to create data dir: %w", err)
	}

	if err := os.WriteFile(c.sessionFile, data, 0600); err != nil {
		return fmt.Errorf("failed to write session file: %w", err)
	}

	c.logger.Info().Msg("Session saved")
	return nil
}

func (c *GMClient) loadSession() (*SessionData, error) {
	data, err := os.ReadFile(c.sessionFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var sess SessionData
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session: %w", err)
	}

	if sess.AuthData == nil {
		return nil, nil
	}

	return &sess, nil
}

// ListConversations returns conversations, serving from cache first with a
// background refresh from the server when connected.
func (c *GMClient) ListConversations(count int, folder string) ([]ConversationResponse, error) {
	cli := c.GetClient()
	if cli == nil {
		return c.db.GetConversations(count)
	}

	// For inbox requests, serve from cache if available and refresh in background
	if folder == "" || folder == "inbox" {
		cached, err := c.db.GetConversations(count)
		if err == nil && len(cached) > 0 {
			go c.backgroundRefreshConversations(count, folder)
			return cached, nil
		}
	}

	// No cache or non-inbox folder — fetch synchronously
	return c.fetchConversationsFromServer(count, folder)
}

// fetchConversationsFromServer fetches conversations from libgm and caches them.
func (c *GMClient) fetchConversationsFromServer(count int, folder string) ([]ConversationResponse, error) {
	cli := c.GetClient()
	if cli == nil {
		return c.db.GetConversations(count)
	}

	f := gmproto.ListConversationsRequest_INBOX
	if folder == "archive" || folder == "archived" {
		f = gmproto.ListConversationsRequest_ARCHIVE
	}

	resp, err := cli.ListConversations(count, f)
	if err != nil {
		c.logger.Warn().Err(err).Msg("Failed to fetch conversations from server, using cache")
		return c.db.GetConversations(count)
	}

	var convs []ConversationResponse
	for _, conv := range resp.GetConversations() {
		c.cacheConvMeta(conv)
		cr := ConvertConversation(conv)
		convs = append(convs, cr)
		if err := c.db.SaveConversation(cr); err != nil {
			c.logger.Warn().Err(err).Str("conv_id", cr.ID).Msg("Failed to save conversation")
		}
	}

	if convs == nil {
		convs = []ConversationResponse{}
	}
	return convs, nil
}

// backgroundRefreshConversations fetches fresh conversations from the server
// and broadcasts updates via WebSocket.
func (c *GMClient) backgroundRefreshConversations(count int, folder string) {
	cli := c.GetClient()
	if cli == nil {
		return
	}

	f := gmproto.ListConversationsRequest_INBOX
	if folder == "archive" || folder == "archived" {
		f = gmproto.ListConversationsRequest_ARCHIVE
	}

	resp, err := cli.ListConversations(count, f)
	if err != nil {
		c.logger.Warn().Err(err).Msg("Background conversation refresh failed")
		return
	}

	for _, conv := range resp.GetConversations() {
		c.cacheConvMeta(conv)
		cr := ConvertConversation(conv)
		if err := c.db.SaveConversation(cr); err != nil {
			c.logger.Warn().Err(err).Str("conv_id", cr.ID).Msg("Failed to save conversation")
		}
		c.hub.BroadcastConversationUpdate(cr)
	}

	c.logger.Debug().Msg("Background conversation refresh complete")
}

// FetchMessages returns messages for a conversation, serving from cache first
// on initial loads (no cursor) with a background refresh from the server.
func (c *GMClient) FetchMessages(conversationID string, count int, cursor string) ([]MessageResponse, string, error) {
	cli := c.GetClient()
	if cli == nil {
		return c.db.GetMessages(conversationID, count, cursor)
	}

	// For initial loads (no cursor), serve from cache if available and refresh in background
	if cursor == "" {
		cached, cachedCursor, err := c.db.GetMessages(conversationID, count, "")
		if err == nil && len(cached) > 0 {
			go c.backgroundRefreshMessages(conversationID, count, cached)
			return cached, cachedCursor, nil
		}
	}

	// No cache, or paginating with cursor — fetch synchronously
	return c.fetchMessagesFromServer(conversationID, count, cursor)
}

// FetchMessagesFresh always fetches from the server (used by GetConversationMedia).
func (c *GMClient) FetchMessagesFresh(conversationID string, count int, cursor string) ([]MessageResponse, string, error) {
	cli := c.GetClient()
	if cli == nil {
		return c.db.GetMessages(conversationID, count, cursor)
	}
	return c.fetchMessagesFromServer(conversationID, count, cursor)
}

// fetchMessagesFromServer fetches messages from libgm and caches them.
func (c *GMClient) fetchMessagesFromServer(conversationID string, count int, cursor string) ([]MessageResponse, string, error) {
	cli := c.GetClient()
	if cli == nil {
		return c.db.GetMessages(conversationID, count, cursor)
	}

	var gmCursor *gmproto.Cursor
	if cursor != "" {
		gmCursor = &gmproto.Cursor{
			LastItemID: cursor,
		}
	}

	resp, err := cli.FetchMessages(conversationID, int64(count), gmCursor)
	if err != nil {
		c.logger.Warn().Err(err).Msg("Failed to fetch messages from server, using cache")
		return c.db.GetMessages(conversationID, count, cursor)
	}

	var msgs []MessageResponse
	for _, msg := range resp.GetMessages() {
		mr := ConvertMessage(msg)
		msgs = append(msgs, mr)
		if err := c.db.SaveMessage(mr); err != nil {
			c.logger.Warn().Err(err).Str("msg_id", mr.ID).Msg("Failed to save message")
		}
	}

	if msgs == nil {
		msgs = []MessageResponse{}
	}

	// Reverse to chronological order (oldest first) for display
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}

	nextCursor := ""
	if c := resp.GetCursor(); c != nil {
		nextCursor = c.GetLastItemID()
	}

	return msgs, nextCursor, nil
}

// backgroundRefreshMessages fetches fresh messages from the server, saves them
// to the DB cache, and broadcasts a single messages_refreshed event so the
// frontend can replace its stale view. Only truly new messages (< 2 min old)
// are broadcast as new_message to trigger notifications.
func (c *GMClient) backgroundRefreshMessages(conversationID string, count int, cachedMsgs []MessageResponse) {
	cli := c.GetClient()
	if cli == nil {
		return
	}

	resp, err := cli.FetchMessages(conversationID, int64(count), nil)
	if err != nil {
		c.logger.Warn().Err(err).Msg("Background message refresh failed")
		return
	}

	// Build set of cached message IDs for detecting new messages
	cachedIDs := make(map[string]bool, len(cachedMsgs))
	for _, m := range cachedMsgs {
		cachedIDs[m.ID] = true
	}

	recentThreshold := time.Now().Add(-2 * time.Minute).UnixMilli()
	hasNewMessages := false

	for _, msg := range resp.GetMessages() {
		mr := ConvertMessage(msg)
		if err := c.db.SaveMessage(mr); err != nil {
			c.logger.Warn().Err(err).Str("msg_id", mr.ID).Msg("Failed to save message")
		}
		if !cachedIDs[mr.ID] {
			hasNewMessages = true
			// Only broadcast as new_message (triggers notifications) if truly recent
			if mr.Timestamp >= recentThreshold {
				c.hub.BroadcastNewMessage(mr)
			}
		}
	}

	// If any messages were added, send the complete refreshed list from the DB
	// so the frontend can replace its stale view in one shot.
	if hasNewMessages {
		refreshed, refreshedCursor, err := c.db.GetMessages(conversationID, count, "")
		if err == nil {
			c.hub.BroadcastMessagesRefreshed(conversationID, refreshed, refreshedCursor)
		}
	}

	c.logger.Debug().Str("conversation", conversationID).Msg("Background message refresh complete")
}

// SendMessage sends a text message.
func (c *GMClient) SendMessage(conversationID, text, replyToID string) (*SendMessageResponse, error) {
	cli := c.GetClient()
	if cli == nil {
		return nil, fmt.Errorf("not connected")
	}

	meta := c.getConvMeta(conversationID)
	if meta == nil {
		return nil, fmt.Errorf("conversation metadata not cached, try reloading conversations")
	}

	tmpID := fmt.Sprintf("tmp_%d", time.Now().UnixNano())

	payload := &gmproto.SendMessageRequest{
		ConversationID: conversationID,
		TmpID:          tmpID,
		SIMPayload:     meta.simPayload,
		MessagePayload: &gmproto.MessagePayload{
			ConversationID: conversationID,
			ParticipantID:  meta.outgoingID,
			TmpID:          tmpID,
			TmpID2:         tmpID,
			MessageInfo: []*gmproto.MessageInfo{{
				Data: &gmproto.MessageInfo_MessageContent{
					MessageContent: &gmproto.MessageContent{
						Content: text,
					},
				},
			}},
		},
	}

	if replyToID != "" {
		payload.Reply = &gmproto.ReplyPayload{
			MessageID: replyToID,
		}
	}

	resp, err := cli.SendMessage(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to send message: %w", err)
	}

	_ = resp

	return &SendMessageResponse{
		MessageID: tmpID,
		Timestamp: time.Now().UnixMilli(),
	}, nil
}

// SendMedia uploads and sends a media message.
func (c *GMClient) SendMedia(conversationID string, fileData []byte, fileName, mimeType, replyToID string) (*SendMessageResponse, error) {
	cli := c.GetClient()
	if cli == nil {
		return nil, fmt.Errorf("not connected")
	}

	meta := c.getConvMeta(conversationID)
	if meta == nil {
		return nil, fmt.Errorf("conversation metadata not cached, try reloading conversations")
	}

	mediaContent, err := cli.UploadMedia(fileData, fileName, mimeType)
	if err != nil {
		return nil, fmt.Errorf("failed to upload media: %w", err)
	}

	tmpID := fmt.Sprintf("tmp_%d", time.Now().UnixNano())

	payload := &gmproto.SendMessageRequest{
		ConversationID: conversationID,
		TmpID:          tmpID,
		SIMPayload:     meta.simPayload,
		MessagePayload: &gmproto.MessagePayload{
			ConversationID: conversationID,
			ParticipantID:  meta.outgoingID,
			TmpID:          tmpID,
			TmpID2:         tmpID,
			MessageInfo: []*gmproto.MessageInfo{
				{
					Data: &gmproto.MessageInfo_MediaContent{
						MediaContent: mediaContent,
					},
				},
			},
		},
	}

	if replyToID != "" {
		payload.Reply = &gmproto.ReplyPayload{
			MessageID: replyToID,
		}
	}

	_, err = cli.SendMessage(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to send media message: %w", err)
	}

	return &SendMessageResponse{
		MessageID: tmpID,
		Timestamp: time.Now().UnixMilli(),
	}, nil
}

// DownloadMedia downloads decrypted media.
func (c *GMClient) DownloadMedia(messageID, mediaID string) ([]byte, string, error) {
	cli := c.GetClient()
	if cli == nil {
		return nil, "", fmt.Errorf("not connected")
	}

	// Look up the message to get the decryption key
	msg, err := c.db.GetMessageByID(messageID)
	if err != nil || msg == nil {
		return nil, "", fmt.Errorf("message not found: %s", messageID)
	}

	var targetMedia *MediaResponse
	for _, m := range msg.Media {
		if m.ID == mediaID || m.ThumbnailMediaID == mediaID {
			targetMedia = &m
			break
		}
	}
	if targetMedia == nil {
		return nil, "", fmt.Errorf("media not found: %s", mediaID)
	}

	// Try downloading with the primary media ID and key (full resolution)
	if targetMedia.ID != "" {
		data, err := cli.DownloadMedia(targetMedia.ID, targetMedia.DecryptionKey)
		if err == nil {
			return data, targetMedia.MimeType, nil
		}
		c.logger.Warn().Err(err).Str("mediaID", targetMedia.ID).Msg("Failed to download primary media, trying thumbnail")
	}

	// Fall back to thumbnail download
	if targetMedia.ThumbnailMediaID != "" {
		data, err := cli.DownloadMedia(targetMedia.ThumbnailMediaID, targetMedia.ThumbnailDecryptionKey)
		if err == nil {
			return data, targetMedia.MimeType, nil
		}
		c.logger.Warn().Err(err).Str("thumbID", targetMedia.ThumbnailMediaID).Msg("Failed to download thumbnail, trying inline data")
	}

	// Last resort: inline data (tiny embedded preview)
	if len(targetMedia.InlineData) > 0 {
		return targetMedia.InlineData, targetMedia.MimeType, nil
	}

	return nil, "", fmt.Errorf("no downloadable media for: %s", mediaID)
}

// RequestFullSizeImage asks Google to make the full-resolution image available.
// The updated message will arrive asynchronously via the event stream.
func (c *GMClient) RequestFullSizeImage(messageID, actionMessageID string) error {
	cli := c.GetClient()
	if cli == nil {
		return fmt.Errorf("not connected")
	}

	_, err := cli.GetFullSizeImage(messageID, actionMessageID)
	if err != nil {
		return fmt.Errorf("failed to request full-size image: %w", err)
	}

	c.logger.Info().Str("msg_id", messageID).Str("action_id", actionMessageID).Msg("Requested full-size image")
	return nil
}

// SendReaction sends or removes a reaction on a message.
func (c *GMClient) SendReaction(conversationID, messageID, emoji string) error {
	cli := c.GetClient()
	if cli == nil {
		return fmt.Errorf("not connected")
	}

	action := gmproto.SendReactionRequest_ADD
	if emoji == "" {
		action = gmproto.SendReactionRequest_REMOVE
	}

	req := &gmproto.SendReactionRequest{
		MessageID:    messageID,
		ReactionData: gmproto.MakeReactionData(emoji),
		Action:       action,
	}

	_, err := cli.SendReaction(req)
	return err
}

// DeleteConversation deletes a conversation from Google's servers and the local cache.
func (c *GMClient) DeleteConversation(conversationID string) error {
	cli := c.GetClient()
	if cli == nil {
		return fmt.Errorf("not connected")
	}

	// Look up the phone number from the conversation's non-me participant
	phone := ""
	conv, err := c.db.GetConversationByID(conversationID)
	if err == nil && conv != nil {
		for _, p := range conv.Participants {
			if !p.IsMe && p.Number != "" {
				phone = p.Number
				break
			}
		}
	}

	if err := cli.DeleteConversation(conversationID, phone); err != nil {
		return fmt.Errorf("failed to delete conversation: %w", err)
	}

	// Clean up local cache
	if err := c.db.DeleteConversation(conversationID); err != nil {
		c.logger.Warn().Err(err).Str("conv_id", conversationID).Msg("Failed to delete conversation from cache")
	}

	// Clean up cached metadata
	c.convMetaMu.Lock()
	delete(c.convMetas, conversationID)
	c.convMetaMu.Unlock()

	// Notify connected clients
	c.hub.BroadcastConversationDeleted(conversationID)

	return nil
}

// MarkRead marks a conversation as read up to a given message.
func (c *GMClient) MarkRead(conversationID, messageID string) error {
	cli := c.GetClient()
	if cli == nil {
		return fmt.Errorf("not connected")
	}

	return cli.MarkRead(conversationID, messageID)
}

// ListContacts fetches the contact list.
func (c *GMClient) ListContacts() ([]ContactResponse, error) {
	cli := c.GetClient()
	if cli == nil {
		return c.db.GetContacts()
	}

	resp, err := cli.ListContacts()
	if err != nil {
		c.logger.Warn().Err(err).Msg("Failed to fetch contacts from server, using cache")
		return c.db.GetContacts()
	}

	var contacts []ContactResponse
	for _, contact := range resp.GetContacts() {
		cr := ConvertContact(contact)
		contacts = append(contacts, cr)
		if err := c.db.SaveContact(cr); err != nil {
			c.logger.Warn().Err(err).Str("contact_id", cr.ID).Msg("Failed to save contact")
		}
	}

	if contacts == nil {
		contacts = []ContactResponse{}
	}
	return contacts, nil
}
