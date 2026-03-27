# API Contract

Base URL: `http://localhost:8080`

## REST Endpoints

### Status & Pairing

#### `GET /api/status`
Returns connection state.
```json
{
  "status": "paired" | "unpaired" | "connecting" | "phone_offline",
  "phoneModel": "Pixel 8 Pro"
}
```

#### `GET /api/pair`
Starts QR code pairing. Returns QR data for display.
```json
{
  "qrUrl": "https://support.google.com/messages/?p=web_computer#?c=..."
}
```

#### `POST /api/pair/google`
Starts Google Account (Gaia) pairing. Requires Google auth cookies obtained via Electron sign-in window.

**Request:**
```json
{
  "cookies": {
    "SID": "...",
    "HSID": "...",
    "OSID": "...",
    "SSID": "...",
    "APISID": "...",
    "SAPISID": "..."
  }
}
```

**Response:**
```json
{
  "emoji": "🦊",
  "emojiUrl": "https://fonts.gstatic.com/s/e/notoemoji/latest/1f98a/emoji.svg"
}
```

After responding, the backend waits for the user to confirm the emoji on their phone. On success, broadcasts `pair_success` via WebSocket. On failure, broadcasts `gaia_pair_error`.

#### `POST /api/unpair`
Disconnects and deletes session. Works for both QR and Google Account sessions. Returns `204 No Content`.

---

### Conversations

#### `GET /api/conversations`
Query params: `?limit=50&folder=inbox`
```json
{
  "conversations": [
    {
      "id": "conv_123",
      "name": "John Doe",
      "isGroup": false,
      "lastMessage": {
        "text": "Hey!",
        "timestamp": 1710500000000,
        "sender": "John Doe"
      },
      "unread": true,
      "participants": [
        {
          "id": "part_456",
          "name": "John Doe",
          "avatarColor": "#4285F4",
          "isMe": false
        }
      ],
      "avatarUrl": ""
    }
  ]
}
```

#### `GET /api/conversations/:id/messages`
Query params: `?limit=50&cursor=<opaque_cursor>`
```json
{
  "messages": [
    {
      "id": "msg_789",
      "conversationId": "conv_123",
      "sender": {
        "id": "part_456",
        "name": "John Doe",
        "isMe": false
      },
      "text": "Hey!",
      "timestamp": 1710500000000,
      "status": "delivered" | "sent" | "read" | "sending" | "failed",
      "reactions": [
        {
          "emoji": "👍",
          "senderIds": ["part_456"]
        }
      ],
      "media": [
        {
          "id": "media_abc",
          "mimeType": "image/jpeg",
          "fileName": "photo.jpg",
          "size": 245000
        }
      ],
      "replyTo": {
        "id": "msg_788",
        "text": "Original message",
        "sender": "John Doe"
      }
    }
  ],
  "nextCursor": "cursor_xyz"
}
```

---

### Messaging

#### `POST /api/messages`
Send a text message.
```json
// Request
{
  "conversationId": "conv_123",
  "text": "Hello!",
  "replyToId": "msg_788"  // optional
}

// Response
{
  "messageId": "msg_790",
  "timestamp": 1710500001000
}
```

#### `POST /api/messages/media`
Send media. Multipart form data:
- `conversationId` (string)
- `file` (binary)
- `replyToId` (string, optional)

```json
// Response
{
  "messageId": "msg_791",
  "timestamp": 1710500002000
}
```

#### `GET /api/media/:messageId/:mediaId`
Download decrypted media. Returns binary with appropriate `Content-Type` header.

---

### Reactions

#### `POST /api/reactions`
```json
// Request
{
  "conversationId": "conv_123",
  "messageId": "msg_789",
  "emoji": "👍"  // empty string to remove reaction
}

// Response: 204 No Content
```

---

### Read Receipts

#### `POST /api/mark-read`
```json
// Request
{
  "conversationId": "conv_123",
  "messageId": "msg_789"
}

// Response: 204 No Content
```

---

### Contacts

#### `GET /api/contacts`
```json
{
  "contacts": [
    {
      "id": "contact_123",
      "name": "John Doe",
      "number": "+15551234567",
      "avatarColor": "#4285F4"
    }
  ]
}
```

---

## WebSocket Events

Endpoint: `ws://localhost:8080/ws`

All events follow this envelope:
```json
{
  "type": "event_type",
  "data": { ... }
}
```

### Server → Client Events

#### `new_message`
```json
{
  "type": "new_message",
  "data": {
    // Same shape as message object above
  }
}
```

#### `message_status`
Message delivery/read status update.
```json
{
  "type": "message_status",
  "data": {
    "messageId": "msg_789",
    "conversationId": "conv_123",
    "status": "delivered" | "read" | "failed"
  }
}
```

#### `typing`
```json
{
  "type": "typing",
  "data": {
    "conversationId": "conv_123",
    "participantId": "part_456",
    "active": true
  }
}
```

#### `conversation_update`
Conversation metadata changed (new message preview, read state, etc.)
```json
{
  "type": "conversation_update",
  "data": {
    // Same shape as conversation object above
  }
}
```

#### `phone_status`
```json
{
  "type": "phone_status",
  "data": {
    "status": "connected" | "offline" | "reconnecting"
  }
}
```

#### `pair_success`
Fired when pairing completes (both QR and Google Account).
```json
{
  "type": "pair_success",
  "data": {}
}
```

#### `qr_refresh`
New QR code generated (old one expired).
```json
{
  "type": "qr_refresh",
  "data": {
    "qrUrl": "https://..."
  }
}
```

#### `gaia_pair_error`
Fired when Google Account pairing fails after the emoji was shown.
```json
{
  "type": "gaia_pair_error",
  "data": {
    "error": "Wrong emoji selected on phone. Please try again.",
    "code": "incorrect_emoji"
  }
}
```
Possible codes: `no_devices`, `phone_not_responding`, `incorrect_emoji`, `cancelled`, `timeout`, `unknown`.

#### `session_expired`
Session invalidated, must re-pair.
```json
{
  "type": "session_expired",
  "data": {}
}
```
