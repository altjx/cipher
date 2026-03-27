package main

import (
	"regexp"
	"strings"

	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
)

var systemChatWithPattern = regexp.MustCompile(`^(rcs chat with|texting with|chatting with|you're now chatting with) .+?(\s*\((sms|sms/mms|rcs|chat)\))?$`)
var reactionTextPattern = regexp.MustCompile(`^reacted .+ to (a |an )?`)
var removedReactionTextPattern = regexp.MustCompile(`^removed a reaction from (a |an )?`)

// API response types matching the API contract

type StatusResponse struct {
	Status     string `json:"status"`
	PhoneModel string `json:"phoneModel,omitempty"`
}

type PairResponse struct {
	QRUrl string `json:"qrUrl"`
}

type ConversationListResponse struct {
	Conversations []ConversationResponse `json:"conversations"`
}

type ConversationResponse struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	IsGroup      bool                `json:"isGroup"`
	LastMessage  *LastMessageResponse `json:"lastMessage,omitempty"`
	Unread       bool                `json:"unread"`
	Participants []ParticipantResponse `json:"participants"`
	AvatarURL    string              `json:"avatarUrl"`
}

type LastMessageResponse struct {
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
	Sender    string `json:"sender"`
	MediaType string `json:"mediaType,omitempty"`
}

type ParticipantResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Number      string `json:"number,omitempty"`
	AvatarColor string `json:"avatarColor"`
	IsMe        bool   `json:"isMe"`
}

type MessageListResponse struct {
	Messages   []MessageResponse `json:"messages"`
	NextCursor string            `json:"nextCursor,omitempty"`
}

type MessageResponse struct {
	ID              string              `json:"id"`
	ConversationID  string              `json:"conversationId"`
	Sender          *SenderResponse     `json:"sender"`
	Text            string              `json:"text"`
	Timestamp       int64               `json:"timestamp"`
	Status          string              `json:"status"`
	Reactions       []ReactionResponse  `json:"reactions"`
	Media           []MediaResponse     `json:"media"`
	ReplyTo          *ReplyToResponse    `json:"replyTo,omitempty"`
	IsSystemMessage  bool                `json:"isSystemMessage"`
	ConversationName string              `json:"conversationName,omitempty"`
	IsGroup          bool                `json:"isGroup,omitempty"`
}

type SenderResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	IsMe bool   `json:"isMe"`
}

type ReactionResponse struct {
	Emoji     string   `json:"emoji"`
	SenderIDs []string `json:"senderIds"`
}

type MediaResponse struct {
	ID                     string `json:"id"`
	MimeType               string `json:"mimeType"`
	FileName               string `json:"fileName"`
	Size                   int64  `json:"size"`
	DecryptionKey          []byte `json:"decryptionKey,omitempty"`
	ThumbnailMediaID       string `json:"thumbnailMediaId,omitempty"`
	ThumbnailDecryptionKey []byte `json:"thumbnailDecryptionKey,omitempty"`
	InlineData             []byte `json:"inlineData,omitempty"`
	ActionMessageID        string `json:"actionMessageId,omitempty"`
	IsThumbnail            bool   `json:"isThumbnail,omitempty"`
}

type ReplyToResponse struct {
	ID     string `json:"id"`
	Text   string `json:"text"`
	Sender string `json:"sender"`
}

type SendMessageRequest struct {
	ConversationID string `json:"conversationId"`
	Text           string `json:"text"`
	ReplyToID      string `json:"replyToId,omitempty"`
}

type SendMessageResponse struct {
	MessageID string `json:"messageId"`
	Timestamp int64  `json:"timestamp"`
}

type SendReactionRequest struct {
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId"`
	Emoji          string `json:"emoji"`
}

type MarkReadRequest struct {
	ConversationID string `json:"conversationId"`
	MessageID      string `json:"messageId"`
	SendReceipt    *bool  `json:"sendReceipt,omitempty"` // nil or true = send, false = local-only
}

type ContactListResponse struct {
	Contacts []ContactResponse `json:"contacts"`
}

type ContactResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Number      string `json:"number"`
	AvatarColor string `json:"avatarColor"`
}

// Search

type SearchResult struct {
	MessageID        string `json:"messageId"`
	ConversationID   string `json:"conversationId"`
	ConversationName string `json:"conversationName"`
	Text             string `json:"text"`
	Timestamp        int64  `json:"timestamp"`
	SenderName       string `json:"senderName"`
	SenderIsMe       bool   `json:"senderIsMe"`
}

type SearchResponse struct {
	Results []SearchResult `json:"results"`
}

// WebSocket event envelope
type WSEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type PhoneStatusData struct {
	Status string `json:"status"`
}

type MessageStatusData struct {
	MessageID      string `json:"messageId"`
	ConversationID string `json:"conversationId"`
	Status         string `json:"status"`
}

type TypingData struct {
	ConversationID string `json:"conversationId"`
	ParticipantID  string `json:"participantId"`
	Name           string `json:"name,omitempty"`
	Active         bool   `json:"active"`
}

type ConversationDeletedData struct {
	ConversationID string `json:"conversationId"`
}

type QRRefreshData struct {
	QRUrl string `json:"qrUrl"`
}

type GaiaPairRequest struct {
	Cookies map[string]string `json:"cookies"`
}

type GaiaPairResponse struct {
	Emoji    string `json:"emoji"`
	EmojiURL string `json:"emojiUrl"`
}

type GaiaPairErrorData struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

type MessagesRefreshedData struct {
	ConversationID string            `json:"conversationId"`
	Messages       []MessageResponse `json:"messages"`
	NextCursor     string            `json:"nextCursor"`
}

// Conversion functions from gmproto types to API response types

func ConvertConversation(conv *gmproto.Conversation) ConversationResponse {
	resp := ConversationResponse{
		ID:        conv.GetConversationID(),
		Name:      conv.GetName(),
		IsGroup:   conv.GetIsGroupChat(),
		Unread:    conv.GetUnread(),
		AvatarURL: conv.GetGroupAvatarURL(),
	}

	if lm := conv.GetLatestMessage(); lm != nil {
		resp.LastMessage = &LastMessageResponse{
			Text:      lm.GetDisplayContent(),
			Timestamp: conv.GetLastMessageTimestamp() / 1000, // Convert microseconds to milliseconds
			Sender:    lm.GetDisplayName(),
		}
	}

	for _, p := range conv.GetParticipants() {
		resp.Participants = append(resp.Participants, ConvertParticipant(p))
	}
	if resp.Participants == nil {
		resp.Participants = []ParticipantResponse{}
	}

	// If not a group chat, derive name from participants
	if resp.Name == "" && !resp.IsGroup {
		for _, p := range resp.Participants {
			if !p.IsMe {
				resp.Name = p.Name
				break
			}
		}
	}

	return resp
}

func ConvertParticipant(p *gmproto.Participant) ParticipantResponse {
	name := p.GetFullName()
	if name == "" {
		name = p.GetFirstName()
	}
	if name == "" {
		name = p.GetFormattedNumber()
	}
	pid := ""
	if id := p.GetID(); id != nil {
		pid = id.GetParticipantID()
	}
	return ParticipantResponse{
		ID:          pid,
		Name:        name,
		Number:      p.GetFormattedNumber(),
		AvatarColor: p.GetAvatarHexColor(),
		IsMe:        p.GetIsMe(),
	}
}

func ConvertMessage(msg *gmproto.Message) MessageResponse {
	resp := MessageResponse{
		ID:             msg.GetMessageID(),
		ConversationID: msg.GetConversationID(),
		Text:           "",
		Timestamp:      msg.GetTimestamp() / 1000, // Convert microseconds to milliseconds
		Status:         MapMessageStatus(msg.GetMessageStatus().GetStatus()),
		Reactions:      []ReactionResponse{},
		Media:          []MediaResponse{},
	}

	// Extract text and media content from MessageInfo slice
	for _, mi := range msg.GetMessageInfo() {
		if mc := mi.GetMessageContent(); mc != nil {
			resp.Text = mc.GetContent()
		}
		if media := mi.GetMediaContent(); media != nil {
			// Include media if it has a mediaID, thumbnailMediaID, or inline data
			hasMedia := media.GetMediaID() != "" || media.GetThumbnailMediaID() != "" || len(media.GetMediaData()) > 0
			if hasMedia {
				isThumbnail := media.GetMediaID() == "" && media.GetThumbnailMediaID() != ""
				resp.Media = append(resp.Media, MediaResponse{
					ID:                     media.GetMediaID(),
					MimeType:               media.GetMimeType(),
					FileName:               media.GetMediaName(),
					Size:                   media.GetSize(),
					DecryptionKey:          media.GetDecryptionKey(),
					ThumbnailMediaID:       media.GetThumbnailMediaID(),
					ThumbnailDecryptionKey: media.GetThumbnailDecryptionKey(),
					InlineData:             media.GetMediaData(),
					ActionMessageID:        mi.GetActionMessageID(),
					IsThumbnail:            isThumbnail,
				})
			}
		}
	}

	// Sender
	if sp := msg.GetSenderParticipant(); sp != nil {
		name := sp.GetFullName()
		if name == "" {
			name = sp.GetFirstName()
		}
		spID := ""
		if id := sp.GetID(); id != nil {
			spID = id.GetParticipantID()
		}
		resp.Sender = &SenderResponse{
			ID:   spID,
			Name: name,
			IsMe: sp.GetIsMe(),
		}
	} else {
		resp.Sender = &SenderResponse{
			ID:   msg.GetParticipantID(),
			Name: msg.GetParticipantID(),
		}
	}

	// Reactions - group by emoji
	emojiMap := make(map[string][]string)
	for _, r := range msg.GetReactions() {
		if r.GetData() != nil {
			emoji := r.GetData().GetUnicode()
			emojiMap[emoji] = append(emojiMap[emoji], r.GetParticipantIDs()...)
		}
	}
	for emoji, senders := range emojiMap {
		resp.Reactions = append(resp.Reactions, ReactionResponse{
			Emoji:     emoji,
			SenderIDs: senders,
		})
	}

	// Reply
	if reply := msg.GetReplyMessage(); reply != nil {
		resp.ReplyTo = &ReplyToResponse{
			ID: reply.GetMessageID(),
		}
	}

	// Detect system/notification messages (e.g., "RCS chat with XYZ")
	resp.IsSystemMessage = isSystemMessage(resp.Text, msg)

	return resp
}

func ConvertContact(c *gmproto.Contact) ContactResponse {
	number := ""
	if n := c.GetNumber(); n != nil {
		number = n.GetNumber()
	}
	return ContactResponse{
		ID:          c.GetContactID(),
		Name:        c.GetName(),
		Number:      number,
		AvatarColor: c.GetAvatarHexColor(),
	}
}

// IsSystemMessageText checks if message text matches known system/notification patterns.
// Exported so db.go can reuse it when loading cached messages.
func IsSystemMessageText(text string) bool {
	lower := strings.ToLower(strings.TrimSpace(text))

	// Patterns like "Texting with 51789 (SMS/MMS)" or "RCS chat with Alice (RCS)"
	// require the trailing protocol marker to avoid false positives on user messages
	if systemChatWithPattern.MatchString(lower) {
		return true
	}

	systemPrefixes := []string{
		"messages are end-to-end encrypted",
		"this chat is now encrypted",
		"chat features are enabled",
		"chat features are not available",
		"you joined the group",
		"you left the group",
		"you removed",
		"you added",
	}
	for _, prefix := range systemPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}

	// Group chat creation messages like "X created this group chat with you and N others"
	if strings.Contains(lower, "created this group chat") {
		return true
	}

	// Reaction notification messages like "Reacted 🤣 to an audio message"
	if reactionTextPattern.MatchString(lower) || removedReactionTextPattern.MatchString(lower) {
		return true
	}

	return false
}

// isSystemMessage detects RCS/system notification messages that aren't real messages.
// These include "RCS chat with ...", "You're now chatting with ...", encryption notices, etc.
func isSystemMessage(text string, msg *gmproto.Message) bool {
	if IsSystemMessageText(text) {
		return true
	}

	// Messages with no sender participant and no media are likely system messages
	if msg.GetSenderParticipant() == nil && msg.GetParticipantID() == "" && len(msg.GetMessageInfo()) == 0 {
		return true
	}

	return false
}

func MapMessageStatus(status gmproto.MessageStatusType) string {
	switch status {
	case gmproto.MessageStatusType_OUTGOING_SENDING,
		gmproto.MessageStatusType_OUTGOING_YET_TO_SEND:
		return "sending"
	case gmproto.MessageStatusType_OUTGOING_DELIVERED:
		return "delivered"
	case gmproto.MessageStatusType_OUTGOING_COMPLETE,
		gmproto.MessageStatusType_INCOMING_COMPLETE:
		return "delivered"
	case gmproto.MessageStatusType_OUTGOING_DISPLAYED:
		return "read"
	case gmproto.MessageStatusType_OUTGOING_FAILED_GENERIC,
		gmproto.MessageStatusType_OUTGOING_FAILED_EMERGENCY_NUMBER,
		gmproto.MessageStatusType_OUTGOING_CANCELED,
		gmproto.MessageStatusType_OUTGOING_FAILED_TOO_LARGE,
		gmproto.MessageStatusType_OUTGOING_FAILED_RECIPIENT_LOST_RCS,
		gmproto.MessageStatusType_OUTGOING_FAILED_NO_RETRY_NO_FALLBACK,
		gmproto.MessageStatusType_OUTGOING_FAILED_RECIPIENT_DID_NOT_DECRYPT,
		gmproto.MessageStatusType_OUTGOING_FAILED_RECIPIENT_LOST_ENCRYPTION,
		gmproto.MessageStatusType_OUTGOING_FAILED_RECIPIENT_DID_NOT_DECRYPT_NO_MORE_RETRY:
		return "failed"
	default:
		return "sent"
	}
}

// MediaTypeFromMime classifies a MIME type into a human-friendly media category.
func MediaTypeFromMime(mimeType string) string {
	if strings.HasPrefix(mimeType, "audio/") {
		return "audio"
	}
	if strings.HasPrefix(mimeType, "video/") {
		return "video"
	}
	if strings.HasPrefix(mimeType, "image/") {
		return "image"
	}
	return ""
}
