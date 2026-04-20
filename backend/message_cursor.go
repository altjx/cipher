package main

import (
	"fmt"
	"strconv"
	"strings"

	"go.mau.fi/mautrix-gmessages/pkg/libgm/gmproto"
)

type messageCursor struct {
	MessageID string
	Timestamp int64
}

func encodeMessageCursor(msg MessageResponse) string {
	if msg.ID == "" || msg.Timestamp <= 0 {
		return ""
	}
	return fmt.Sprintf("%s:%d", msg.ID, msg.Timestamp)
}

func parseMessageCursor(raw string) (messageCursor, error) {
	if raw == "" {
		return messageCursor{}, nil
	}

	// Backward-compatible fallback for older cache pages that only stored a timestamp.
	if !strings.Contains(raw, ":") {
		ts, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return messageCursor{}, fmt.Errorf("invalid legacy message cursor %q: %w", raw, err)
		}
		return messageCursor{Timestamp: ts}, nil
	}

	idx := strings.LastIndex(raw, ":")
	if idx <= 0 || idx == len(raw)-1 {
		return messageCursor{}, fmt.Errorf("invalid message cursor %q", raw)
	}

	ts, err := strconv.ParseInt(raw[idx+1:], 10, 64)
	if err != nil {
		return messageCursor{}, fmt.Errorf("invalid message cursor timestamp %q: %w", raw, err)
	}

	return messageCursor{
		MessageID: raw[:idx],
		Timestamp: ts,
	}, nil
}

func (c messageCursor) toGMCursor() *gmproto.Cursor {
	if c.MessageID == "" || c.Timestamp <= 0 {
		return nil
	}
	return &gmproto.Cursor{
		LastItemID:        c.MessageID,
		LastItemTimestamp: c.Timestamp,
	}
}
