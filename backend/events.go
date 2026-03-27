package main

import (
	"time"

	"go.mau.fi/mautrix-gmessages/pkg/libgm"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/events"
	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
)

// handleEvent is the libgm event handler. It type-switches on all event types
// and dispatches to the appropriate handlers.
func (c *GMClient) handleEvent(evt any) {
	switch v := evt.(type) {
	case *events.ClientReady:
		c.handleClientReady(v)

	case *libgm.WrappedMessage:
		c.handleWrappedMessage(v)

	case *gmproto.Conversation:
		c.handleConversationUpdate(v)

	case *events.AuthTokenRefreshed:
		c.handleAuthTokenRefreshed()

	case *events.PairSuccessful:
		c.handlePairSuccessful(v)

	case *events.PhoneNotResponding:
		c.handlePhoneNotResponding()

	case *events.PhoneRespondingAgain:
		c.handlePhoneRespondingAgain()

	case *events.ListenFatalError:
		c.handleListenFatalError(v)

	case *gmproto.TypingData:
		c.handleTyping(v)

	case *events.ListenTemporaryError:
		c.logger.Warn().Err(v.Error).Msg("Temporary listen error")
		c.hub.BroadcastPhoneStatus("reconnecting")

	case *events.ListenRecovered:
		c.logger.Info().Msg("Listen connection recovered")
		c.status.Store(StatusPaired)
		c.hub.BroadcastPhoneStatus("connected")

	case *events.PingFailed:
		c.logger.Warn().Err(v.Error).Int("count", v.ErrorCount).Msg("Ping failed")
		if v.ErrorCount >= 3 {
			c.hub.BroadcastPhoneStatus("reconnecting")
		}

	case *events.GaiaLoggedOut:
		c.logger.Warn().Msg("Gaia logged out")
		c.StopHealthCheck()
		c.status.Store(StatusUnpaired)
		c.hub.BroadcastSessionExpired()

	default:
		c.logger.Debug().Type("event_type", evt).Msg("Unhandled event")
	}
}

func (c *GMClient) handleClientReady(evt *events.ClientReady) {
	c.logger.Info().Str("session_id", evt.SessionID).Msg("Client ready")
	c.status.Store(StatusPaired)

	// Cache initial conversations (skip deleted ones)
	activeIDs := make(map[string]bool)
	for _, conv := range evt.Conversations {
		if conv.GetStatus() == gmproto.ConversationStatus_DELETED {
			continue
		}
		convID := conv.GetConversationID()
		activeIDs[convID] = true
		c.cacheConvMeta(conv)
		cr := ConvertConversation(conv)
		// Enrich media type from cached messages when last message has no text
		if cr.LastMessage != nil && cr.LastMessage.Text == "" && cr.LastMessage.MediaType == "" {
			if mt := c.db.GetLatestMessageMediaType(cr.ID); mt != "" {
				cr.LastMessage.MediaType = mt
			}
		}
		if err := c.db.SaveConversation(cr); err != nil {
			c.logger.Warn().Err(err).Str("conv_id", cr.ID).Msg("Failed to cache conversation")
		}
	}

	// Remove cached conversations that no longer exist on the server
	if cachedIDs, err := c.db.GetConversationIDs(); err == nil {
		for _, id := range cachedIDs {
			if !activeIDs[id] {
				c.logger.Info().Str("conv_id", id).Msg("Removing stale conversation from cache")
				_ = c.db.DeleteConversation(id)
			}
		}
	}

	// Save session after successful connection
	if err := c.saveSession(); err != nil {
		c.logger.Error().Err(err).Msg("Failed to save session on ready")
	}

	// Start periodic health check
	c.StartHealthCheck()

	// After restoring a session, validate it's truly alive by making a
	// server call. If the session was revoked on Google's side, ClientReady
	// still fires with stale cached data and no error — the only way to
	// detect this is to try an active request and see if it works.
	if c.freshSession.Load() {
		go func() {
			time.Sleep(3 * time.Second)
			c.freshSession.Store(false)
			c.validateSession()
		}()
	}
}

func (c *GMClient) handleWrappedMessage(msg *libgm.WrappedMessage) {
	if msg.Message == nil {
		return
	}

	mr := ConvertMessage(msg.Message)
	c.logger.Info().
		Str("msg_id", mr.ID).
		Str("conv_id", mr.ConversationID).
		Msg("New message received")

	// Check if this message already exists (reaction/status update vs truly new)
	existingMsg, _ := c.db.GetMessageByID(mr.ID)
	isUpdate := existingMsg != nil

	// Enrich with conversation metadata for notifications
	if conv, err := c.db.GetConversationByID(mr.ConversationID); err == nil && conv != nil {
		mr.ConversationName = conv.Name
		mr.IsGroup = conv.IsGroup
	}

	// Save to DB
	if err := c.db.SaveMessage(mr); err != nil {
		c.logger.Error().Err(err).Str("msg_id", mr.ID).Msg("Failed to save message")
	}

	// Broadcast to WebSocket clients
	if !msg.IsOld {
		if isUpdate {
			c.hub.BroadcastMessageUpdate(mr)
		} else {
			c.hub.BroadcastNewMessage(mr)
		}
	}

	// Also broadcast message status updates
	if mr.Status != "" && mr.Status != "sent" {
		c.hub.BroadcastMessageStatus(mr.ID, mr.ConversationID, mr.Status)
	}
}

func (c *GMClient) handleConversationUpdate(conv *gmproto.Conversation) {
	convID := conv.GetConversationID()
	status := conv.GetStatus()

	// If the conversation was deleted, remove it from the cache and DB
	if status == gmproto.ConversationStatus_DELETED {
		c.logger.Info().Str("conv_id", convID).Msg("Conversation deleted")
		if err := c.db.DeleteConversation(convID); err != nil {
			c.logger.Error().Err(err).Str("conv_id", convID).Msg("Failed to delete conversation from DB")
		}
		c.hub.BroadcastConversationDeleted(convID)
		return
	}

	c.cacheConvMeta(conv)
	cr := ConvertConversation(conv)
	c.logger.Info().Str("conv_id", cr.ID).Msg("Conversation updated")

	// Enrich media type from cached messages when last message has no text
	if cr.LastMessage != nil && cr.LastMessage.Text == "" && cr.LastMessage.MediaType == "" {
		if mt := c.db.GetLatestMessageMediaType(cr.ID); mt != "" {
			cr.LastMessage.MediaType = mt
		}
	}

	if err := c.db.SaveConversation(cr); err != nil {
		c.logger.Error().Err(err).Str("conv_id", cr.ID).Msg("Failed to save conversation update")
	}

	c.hub.BroadcastConversationUpdate(cr)
}

func (c *GMClient) handleAuthTokenRefreshed() {
	c.logger.Info().Msg("Auth token refreshed, saving session")
	if err := c.saveSession(); err != nil {
		c.logger.Error().Err(err).Msg("Failed to save session after token refresh")
	}
}

func (c *GMClient) handlePairSuccessful(evt *events.PairSuccessful) {
	c.logger.Info().Str("phone_id", evt.PhoneID).Msg("Pairing successful")

	// Stop the QR refresh loop
	c.pairingMu.Lock()
	if c.pairingCancel != nil {
		close(c.pairingCancel)
		c.pairingCancel = nil
	}
	c.pairingMu.Unlock()

	c.status.Store(StatusPaired)

	// Save session
	if err := c.saveSession(); err != nil {
		c.logger.Error().Err(err).Msg("Failed to save session after pairing")
	}

	c.hub.BroadcastPairSuccess()
}

func (c *GMClient) handlePhoneNotResponding() {
	c.logger.Warn().Msg("Phone not responding")
	c.status.Store(StatusPhoneOffline)
	c.hub.BroadcastPhoneStatus("offline")
}

func (c *GMClient) handlePhoneRespondingAgain() {
	c.logger.Info().Msg("Phone responding again")
	c.status.Store(StatusPaired)
	c.hub.BroadcastPhoneStatus("connected")
}

func (c *GMClient) handleListenFatalError(evt *events.ListenFatalError) {
	c.logger.Error().Err(evt.Error).Msg("Fatal listen error, session expired")
	c.StopHealthCheck()
	c.status.Store(StatusUnpaired)
	c.hub.BroadcastSessionExpired()
}

func (c *GMClient) handleTyping(data *gmproto.TypingData) {
	number := ""
	if u := data.GetUser(); u != nil {
		number = u.GetNumber()
	}

	// Resolve the phone number to a participant name from the conversation
	convID := data.GetConversationID()
	participantID := number
	name := ""
	if conv, err := c.db.GetConversationByID(convID); err == nil && conv != nil {
		for _, p := range conv.Participants {
			if !p.IsMe && number != "" {
				// Use first non-self participant as a match for 1:1 chats,
				// or try to match by ID containing the number
				participantID = p.ID
				name = p.Name
				break
			}
		}
	}

	c.hub.BroadcastTyping(
		convID,
		participantID,
		name,
		data.GetType() == gmproto.TypingTypes_STARTED_TYPING,
	)
}
