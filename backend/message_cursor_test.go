package main

import "testing"

func TestEncodeMessageCursor(t *testing.T) {
	msg := MessageResponse{ID: "12345", Timestamp: 1713628800000}
	if got := encodeMessageCursor(msg); got != "12345:1713628800000" {
		t.Fatalf("encodeMessageCursor() = %q", got)
	}
}

func TestParseMessageCursor(t *testing.T) {
	cursor, err := parseMessageCursor("12345:1713628800000")
	if err != nil {
		t.Fatalf("parseMessageCursor() error = %v", err)
	}
	if cursor.MessageID != "12345" || cursor.Timestamp != 1713628800000 {
		t.Fatalf("unexpected parsed cursor: %+v", cursor)
	}
	if gm := cursor.toGMCursor(); gm == nil || gm.GetLastItemID() != "12345" || gm.GetLastItemTimestamp() != 1713628800000 {
		t.Fatalf("unexpected gm cursor: %+v", gm)
	}
}

func TestParseLegacyMessageCursor(t *testing.T) {
	cursor, err := parseMessageCursor("1713628800000")
	if err != nil {
		t.Fatalf("parseMessageCursor() error = %v", err)
	}
	if cursor.MessageID != "" || cursor.Timestamp != 1713628800000 {
		t.Fatalf("unexpected parsed cursor: %+v", cursor)
	}
	if gm := cursor.toGMCursor(); gm != nil {
		t.Fatalf("expected nil gm cursor, got %+v", gm)
	}
}
