package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"

	_ "modernc.org/sqlite"

	"github.com/rs/zerolog"
)

type Database struct {
	db     *sql.DB
	mu     sync.RWMutex
	logger zerolog.Logger
}

func NewDatabase(dbPath string, logger zerolog.Logger) (*Database, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable WAL mode for better concurrent reads
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("failed to set WAL mode: %w", err)
	}

	d := &Database{
		db:     db,
		logger: logger.With().Str("component", "db").Logger(),
	}

	if err := d.migrate(); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return d, nil
}

func (d *Database) Close() error {
	return d.db.Close()
}

func (d *Database) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS conversations (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		is_group INTEGER NOT NULL DEFAULT 0,
		unread INTEGER NOT NULL DEFAULT 0,
		avatar_url TEXT NOT NULL DEFAULT '',
		last_message_text TEXT NOT NULL DEFAULT '',
		last_message_timestamp INTEGER NOT NULL DEFAULT 0,
		last_message_sender TEXT NOT NULL DEFAULT '',
		participants_json TEXT NOT NULL DEFAULT '[]',
		updated_at INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		sender_id TEXT NOT NULL DEFAULT '',
		sender_name TEXT NOT NULL DEFAULT '',
		sender_is_me INTEGER NOT NULL DEFAULT 0,
		text TEXT NOT NULL DEFAULT '',
		timestamp INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'sent',
		reactions_json TEXT NOT NULL DEFAULT '[]',
		media_json TEXT NOT NULL DEFAULT '[]',
		reply_to_json TEXT,
		FOREIGN KEY (conversation_id) REFERENCES conversations(id)
	);

	CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp DESC);

	CREATE TABLE IF NOT EXISTS contacts (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		number TEXT NOT NULL DEFAULT '',
		avatar_color TEXT NOT NULL DEFAULT ''
	);
	`
	_, err := d.db.Exec(schema)
	return err
}

func (d *Database) SaveConversation(conv ConversationResponse) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	participantsJSON, err := json.Marshal(conv.Participants)
	if err != nil {
		return fmt.Errorf("failed to marshal participants: %w", err)
	}

	lastText := ""
	lastTimestamp := int64(0)
	lastSender := ""
	if conv.LastMessage != nil {
		lastText = conv.LastMessage.Text
		lastTimestamp = conv.LastMessage.Timestamp
		lastSender = conv.LastMessage.Sender
	}

	_, err = d.db.Exec(`
		INSERT INTO conversations (id, name, is_group, unread, avatar_url, last_message_text, last_message_timestamp, last_message_sender, participants_json, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name,
			is_group=excluded.is_group,
			unread=excluded.unread,
			avatar_url=excluded.avatar_url,
			last_message_text=excluded.last_message_text,
			last_message_timestamp=excluded.last_message_timestamp,
			last_message_sender=excluded.last_message_sender,
			participants_json=excluded.participants_json,
			updated_at=excluded.updated_at
	`, conv.ID, conv.Name, conv.IsGroup, conv.Unread, conv.AvatarURL,
		lastText, lastTimestamp, lastSender,
		string(participantsJSON), lastTimestamp)
	return err
}

func (d *Database) GetConversations(limit int) ([]ConversationResponse, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	rows, err := d.db.Query(`
		SELECT id, name, is_group, unread, avatar_url, last_message_text, last_message_timestamp, last_message_sender, participants_json
		FROM conversations
		ORDER BY last_message_timestamp DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var convs []ConversationResponse
	for rows.Next() {
		var c ConversationResponse
		var isGroup int
		var unread int
		var lastText, lastSender string
		var lastTimestamp int64
		var participantsJSON string

		if err := rows.Scan(&c.ID, &c.Name, &isGroup, &unread, &c.AvatarURL,
			&lastText, &lastTimestamp, &lastSender, &participantsJSON); err != nil {
			return nil, err
		}

		c.IsGroup = isGroup != 0
		c.Unread = unread != 0

		if lastText != "" || lastTimestamp != 0 {
			c.LastMessage = &LastMessageResponse{
				Text:      lastText,
				Timestamp: lastTimestamp,
				Sender:    lastSender,
			}
		}

		if err := json.Unmarshal([]byte(participantsJSON), &c.Participants); err != nil {
			d.logger.Warn().Err(err).Str("conversation_id", c.ID).Msg("Failed to unmarshal participants")
			c.Participants = []ParticipantResponse{}
		}

		convs = append(convs, c)
	}

	if convs == nil {
		convs = []ConversationResponse{}
	}
	return convs, nil
}

func (d *Database) GetConversationByID(id string) (*ConversationResponse, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var c ConversationResponse
	var isGroup, unread int
	var lastText, lastSender, participantsJSON string
	var lastTimestamp int64

	err := d.db.QueryRow(`
		SELECT id, name, is_group, unread, avatar_url, last_message_text, last_message_timestamp, last_message_sender, participants_json
		FROM conversations WHERE id = ?
	`, id).Scan(&c.ID, &c.Name, &isGroup, &unread, &c.AvatarURL,
		&lastText, &lastTimestamp, &lastSender, &participantsJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	c.IsGroup = isGroup != 0
	c.Unread = unread != 0
	if lastText != "" || lastTimestamp != 0 {
		c.LastMessage = &LastMessageResponse{Text: lastText, Timestamp: lastTimestamp, Sender: lastSender}
	}
	if err := json.Unmarshal([]byte(participantsJSON), &c.Participants); err != nil {
		c.Participants = []ParticipantResponse{}
	}
	return &c, nil
}

func (d *Database) SaveMessage(msg MessageResponse) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	reactionsJSON, err := json.Marshal(msg.Reactions)
	if err != nil {
		return fmt.Errorf("failed to marshal reactions: %w", err)
	}
	mediaJSON, err := json.Marshal(msg.Media)
	if err != nil {
		return fmt.Errorf("failed to marshal media: %w", err)
	}

	var replyJSON *string
	if msg.ReplyTo != nil {
		b, err := json.Marshal(msg.ReplyTo)
		if err != nil {
			return fmt.Errorf("failed to marshal reply: %w", err)
		}
		s := string(b)
		replyJSON = &s
	}

	senderID := ""
	senderName := ""
	senderIsMe := false
	if msg.Sender != nil {
		senderID = msg.Sender.ID
		senderName = msg.Sender.Name
		senderIsMe = msg.Sender.IsMe
	}

	_, err = d.db.Exec(`
		INSERT INTO messages (id, conversation_id, sender_id, sender_name, sender_is_me, text, timestamp, status, reactions_json, media_json, reply_to_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			status=excluded.status,
			reactions_json=excluded.reactions_json,
			media_json=excluded.media_json,
			text=excluded.text
	`, msg.ID, msg.ConversationID, senderID, senderName, senderIsMe,
		msg.Text, msg.Timestamp, msg.Status,
		string(reactionsJSON), string(mediaJSON), replyJSON)
	return err
}

func (d *Database) GetMessages(conversationID string, limit int, cursor string) ([]MessageResponse, string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	var rows *sql.Rows
	var err error

	if cursor != "" {
		rows, err = d.db.Query(`
			SELECT id, conversation_id, sender_id, sender_name, sender_is_me, text, timestamp, status, reactions_json, media_json, reply_to_json
			FROM messages
			WHERE conversation_id = ? AND timestamp < ?
			ORDER BY timestamp DESC
			LIMIT ?
		`, conversationID, cursor, limit)
	} else {
		rows, err = d.db.Query(`
			SELECT id, conversation_id, sender_id, sender_name, sender_is_me, text, timestamp, status, reactions_json, media_json, reply_to_json
			FROM messages
			WHERE conversation_id = ?
			ORDER BY timestamp DESC
			LIMIT ?
		`, conversationID, limit)
	}
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var msgs []MessageResponse
	for rows.Next() {
		var m MessageResponse
		var senderID, senderName string
		var senderIsMe bool
		var reactionsJSON, mediaJSON string
		var replyJSON *string

		if err := rows.Scan(&m.ID, &m.ConversationID, &senderID, &senderName, &senderIsMe,
			&m.Text, &m.Timestamp, &m.Status, &reactionsJSON, &mediaJSON, &replyJSON); err != nil {
			return nil, "", err
		}

		m.Sender = &SenderResponse{
			ID:   senderID,
			Name: senderName,
			IsMe: senderIsMe,
		}

		if err := json.Unmarshal([]byte(reactionsJSON), &m.Reactions); err != nil {
			m.Reactions = []ReactionResponse{}
		}
		if err := json.Unmarshal([]byte(mediaJSON), &m.Media); err != nil {
			m.Media = []MediaResponse{}
		}
		if replyJSON != nil {
			var reply ReplyToResponse
			if err := json.Unmarshal([]byte(*replyJSON), &reply); err == nil {
				m.ReplyTo = &reply
			}
		}

		msgs = append(msgs, m)
	}

	if msgs == nil {
		msgs = []MessageResponse{}
	}

	nextCursor := ""
	if len(msgs) == limit {
		nextCursor = fmt.Sprintf("%d", msgs[len(msgs)-1].Timestamp)
	}

	// Reverse to chronological order (oldest first) for display
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}

	return msgs, nextCursor, nil
}

func (d *Database) DeleteConversation(conversationID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM messages WHERE conversation_id = ?`, conversationID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM conversations WHERE id = ?`, conversationID); err != nil {
		return err
	}

	return tx.Commit()
}

func (d *Database) UpdateMessageStatus(messageID, status string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(`UPDATE messages SET status = ? WHERE id = ?`, status, messageID)
	return err
}

func (d *Database) SaveContact(c ContactResponse) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(`
		INSERT INTO contacts (id, name, number, avatar_color)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name=excluded.name,
			number=excluded.number,
			avatar_color=excluded.avatar_color
	`, c.ID, c.Name, c.Number, c.AvatarColor)
	return err
}

func (d *Database) GetContacts() ([]ContactResponse, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(`SELECT id, name, number, avatar_color FROM contacts ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var contacts []ContactResponse
	for rows.Next() {
		var c ContactResponse
		if err := rows.Scan(&c.ID, &c.Name, &c.Number, &c.AvatarColor); err != nil {
			return nil, err
		}
		contacts = append(contacts, c)
	}

	if contacts == nil {
		contacts = []ContactResponse{}
	}
	return contacts, nil
}

func (d *Database) GetMessageByID(messageID string) (*MessageResponse, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var m MessageResponse
	var senderID, senderName string
	var senderIsMe bool
	var reactionsJSON, mediaJSON string
	var replyJSON *string

	err := d.db.QueryRow(`
		SELECT id, conversation_id, sender_id, sender_name, sender_is_me, text, timestamp, status, reactions_json, media_json, reply_to_json
		FROM messages WHERE id = ?
	`, messageID).Scan(&m.ID, &m.ConversationID, &senderID, &senderName, &senderIsMe,
		&m.Text, &m.Timestamp, &m.Status, &reactionsJSON, &mediaJSON, &replyJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	m.Sender = &SenderResponse{ID: senderID, Name: senderName, IsMe: senderIsMe}
	if err := json.Unmarshal([]byte(reactionsJSON), &m.Reactions); err != nil {
		m.Reactions = []ReactionResponse{}
	}
	if err := json.Unmarshal([]byte(mediaJSON), &m.Media); err != nil {
		m.Media = []MediaResponse{}
	}
	if replyJSON != nil {
		var reply ReplyToResponse
		if err := json.Unmarshal([]byte(*replyJSON), &reply); err == nil {
			m.ReplyTo = &reply
		}
	}

	return &m, nil
}

func (d *Database) GetMediaMessages(conversationID string, limit int, cursor string) ([]MessageResponse, string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if limit <= 0 {
		limit = 30
	}

	var rows *sql.Rows
	var err error

	if cursor != "" {
		rows, err = d.db.Query(`
			SELECT id, conversation_id, sender_id, sender_name, sender_is_me, text, timestamp, status, reactions_json, media_json, reply_to_json
			FROM messages
			WHERE conversation_id = ? AND media_json != '[]' AND timestamp < ?
			ORDER BY timestamp DESC
			LIMIT ?
		`, conversationID, cursor, limit)
	} else {
		rows, err = d.db.Query(`
			SELECT id, conversation_id, sender_id, sender_name, sender_is_me, text, timestamp, status, reactions_json, media_json, reply_to_json
			FROM messages
			WHERE conversation_id = ? AND media_json != '[]'
			ORDER BY timestamp DESC
			LIMIT ?
		`, conversationID, limit)
	}
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	var msgs []MessageResponse
	for rows.Next() {
		var m MessageResponse
		var senderID, senderName string
		var senderIsMe bool
		var reactionsJSON, mediaJSON string
		var replyJSON *string

		if err := rows.Scan(&m.ID, &m.ConversationID, &senderID, &senderName, &senderIsMe,
			&m.Text, &m.Timestamp, &m.Status, &reactionsJSON, &mediaJSON, &replyJSON); err != nil {
			return nil, "", err
		}

		m.Sender = &SenderResponse{
			ID:   senderID,
			Name: senderName,
			IsMe: senderIsMe,
		}

		if err := json.Unmarshal([]byte(reactionsJSON), &m.Reactions); err != nil {
			m.Reactions = []ReactionResponse{}
		}
		if err := json.Unmarshal([]byte(mediaJSON), &m.Media); err != nil {
			m.Media = []MediaResponse{}
		}
		if replyJSON != nil {
			var reply ReplyToResponse
			if err := json.Unmarshal([]byte(*replyJSON), &reply); err == nil {
				m.ReplyTo = &reply
			}
		}

		msgs = append(msgs, m)
	}

	if msgs == nil {
		msgs = []MessageResponse{}
	}

	nextCursor := ""
	if len(msgs) == limit {
		nextCursor = fmt.Sprintf("%d", msgs[len(msgs)-1].Timestamp)
	}

	return msgs, nextCursor, nil
}

func (d *Database) SearchMessages(query string, limit int) ([]SearchResult, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	rows, err := d.db.Query(`
		SELECT m.id, m.conversation_id, m.text, m.timestamp, m.sender_name, m.sender_is_me, c.name
		FROM messages m
		JOIN conversations c ON m.conversation_id = c.id
		WHERE m.text LIKE '%' || ? || '%'
		ORDER BY m.timestamp DESC
		LIMIT ?
	`, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.MessageID, &r.ConversationID, &r.Text, &r.Timestamp, &r.SenderName, &r.SenderIsMe, &r.ConversationName); err != nil {
			return nil, err
		}
		results = append(results, r)
	}

	if results == nil {
		results = []SearchResult{}
	}
	return results, nil
}
