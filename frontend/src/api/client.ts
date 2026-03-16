// ─── Types ───────────────────────────────────────────────────────────────────

export interface StatusResponse {
  status: 'paired' | 'unpaired' | 'connecting' | 'phone_offline';
  phoneModel?: string;
}

export interface PairResponse {
  qrUrl: string;
}

export interface Participant {
  id: string;
  name: string;
  number?: string;
  avatarColor: string;
  isMe: boolean;
}

export interface LastMessage {
  text: string;
  timestamp: number;
  sender: string;
}

export interface Conversation {
  id: string;
  name: string;
  isGroup: boolean;
  lastMessage: LastMessage;
  unread: boolean;
  participants: Participant[];
  avatarUrl: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface MessageSender {
  id: string;
  name: string;
  isMe: boolean;
}

export interface Reaction {
  emoji: string;
  senderIds: string[];
}

export interface MediaItem {
  id: string;
  mimeType: string;
  fileName: string;
  size: number;
  thumbnailMediaId?: string;
  inlineData?: string; // base64
  actionMessageId?: string;
  isThumbnail?: boolean;
}

export interface ReplyTo {
  id: string;
  text: string;
  sender: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: MessageSender;
  text: string;
  timestamp: number;
  status: 'delivered' | 'sent' | 'read' | 'sending' | 'failed';
  reactions: Reaction[];
  media: MediaItem[];
  replyTo: ReplyTo | null;
  isSystemMessage: boolean;
}

export interface MessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

export interface SendMessageRequest {
  conversationId: string;
  text: string;
  replyToId?: string;
}

export interface SendMessageResponse {
  messageId: string;
  timestamp: number;
}

export interface ReactionRequest {
  conversationId: string;
  messageId: string;
  emoji: string;
}

export interface MarkReadRequest {
  conversationId: string;
  messageId: string;
}

export interface Contact {
  id: string;
  name: string;
  number: string;
  avatarColor: string;
}

export interface ContactsResponse {
  contacts: Contact[];
}

// ─── WebSocket event types ───────────────────────────────────────────────────

export interface WsNewMessage {
  type: 'new_message';
  data: Message;
}

export interface WsMessagesRefreshed {
  type: 'messages_refreshed';
  data: {
    conversationId: string;
    messages: Message[];
    nextCursor: string;
  };
}

export interface WsMessageUpdate {
  type: 'message_update';
  data: Message;
}

export interface WsMessageStatus {
  type: 'message_status';
  data: {
    messageId: string;
    conversationId: string;
    status: 'delivered' | 'read' | 'failed';
  };
}

export interface WsTyping {
  type: 'typing';
  data: {
    conversationId: string;
    participantId: string;
    name?: string;
    active: boolean;
  };
}

export interface WsConversationUpdate {
  type: 'conversation_update';
  data: Conversation;
}

export interface WsPhoneStatus {
  type: 'phone_status';
  data: {
    status: 'connected' | 'offline' | 'reconnecting';
  };
}

export interface WsPairSuccess {
  type: 'pair_success';
  data: Record<string, never>;
}

export interface WsQrRefresh {
  type: 'qr_refresh';
  data: {
    qrUrl: string;
  };
}

export interface WsConversationDeleted {
  type: 'conversation_deleted';
  data: {
    conversationId: string;
  };
}

export interface WsSessionExpired {
  type: 'session_expired';
  data: Record<string, never>;
}

export type WsEvent =
  | WsNewMessage
  | WsMessagesRefreshed
  | WsMessageUpdate
  | WsMessageStatus
  | WsTyping
  | WsConversationUpdate
  | WsConversationDeleted
  | WsPhoneStatus
  | WsPairSuccess
  | WsQrRefresh
  | WsSessionExpired;

export type WsEventType = WsEvent['type'];

// ─── API Client ──────────────────────────────────────────────────────────────

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/api/status');
}

export function startPairing(): Promise<PairResponse> {
  return request<PairResponse>('/api/pair');
}

export function unpair(): Promise<void> {
  return request<void>('/api/unpair', { method: 'POST' });
}

export function deleteConversation(convId: string): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(convId)}`, { method: 'DELETE' });
}

export function fetchConversations(limit?: number, folder?: string): Promise<ConversationsResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (folder) params.set('folder', folder);
  const qs = params.toString();
  return request<ConversationsResponse>(`/api/conversations${qs ? `?${qs}` : ''}`);
}

export function fetchMessages(convId: string, cursor?: string): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return request<MessagesResponse>(`/api/conversations/${convId}/messages${qs ? `?${qs}` : ''}`);
}

export function sendMessage(convId: string, text: string, replyToId?: string): Promise<SendMessageResponse> {
  const body: SendMessageRequest = { conversationId: convId, text };
  if (replyToId) body.replyToId = replyToId;
  return request<SendMessageResponse>('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function sendMedia(convId: string, file: File, replyToId?: string): Promise<SendMessageResponse> {
  const form = new FormData();
  form.append('conversationId', convId);
  form.append('file', file);
  if (replyToId) form.append('replyToId', replyToId);
  return request<SendMessageResponse>('/api/messages/media', {
    method: 'POST',
    body: form,
  });
}

export function downloadMediaUrl(messageId: string, mediaId: string): string {
  return `/api/media?messageId=${encodeURIComponent(messageId)}&mediaId=${encodeURIComponent(mediaId)}`;
}

export function requestFullSizeImage(messageId: string, actionMessageId: string): Promise<void> {
  return request<void>('/api/media/full-size', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, actionMessageId }),
  });
}

export function sendReaction(convId: string, msgId: string, emoji: string): Promise<void> {
  const body: ReactionRequest = { conversationId: convId, messageId: msgId, emoji };
  return request<void>('/api/reactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function markRead(convId: string, msgId: string): Promise<void> {
  const body: MarkReadRequest = { conversationId: convId, messageId: msgId };
  return request<void>('/api/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchContacts(): Promise<ContactsResponse> {
  return request<ContactsResponse>('/api/contacts');
}

// Search

export interface SearchResult {
  messageId: string;
  conversationId: string;
  conversationName: string;
  text: string;
  timestamp: number;
  senderName: string;
  senderIsMe: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
}

export function searchMessages(query: string): Promise<SearchResponse> {
  return request<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`);
}

export function fetchConversationMedia(convId: string, cursor?: string): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return request<MessagesResponse>(`/api/conversations/${convId}/media${qs ? `?${qs}` : ''}`);
}
