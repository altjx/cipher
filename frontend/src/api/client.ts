// ─── Types ───────────────────────────────────────────────────────────────────

export interface StatusResponse {
  status: 'paired' | 'unpaired' | 'connecting' | 'phone_offline';
  phoneModel?: string;
}

export interface PairResponse {
  qrUrl: string;
}

export interface GaiaPairResponse {
  emoji: string;
  emojiUrl: string;
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
  mediaType?: string;
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

export interface WsGaiaPairError {
  type: 'gaia_pair_error';
  data: {
    error: string;
    code: string;
  };
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
  | WsSessionExpired
  | WsGaiaPairError;

export type WsEventType = WsEvent['type'];

// ─── Electron bridge ─────────────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI?: {
      getBackendUrl: () => Promise<string>;
      getWsUrl: () => Promise<string>;
      onWsEvent: (callback: (event: { type: string; data: unknown }) => void) => void;
      onNavigateToConversation: (callback: (conversationId: string) => void) => void;
      openImageInPreview: (imageUrl: string) => Promise<{ success: boolean; error?: string }>;
      getSettings: () => Promise<{ notificationSound: string }>;
      setNotificationSound: (name: string) => Promise<{ notificationSound: string }>;
      previewSound: (name: string) => Promise<{ success: boolean; error?: string }>;
      getAvailableSounds: () => Promise<string[]>;
      openExternal: (url: string) => Promise<void>;
      googleSignIn: () => Promise<{ cookies: Record<string, string> | null; cancelled?: boolean }>;
    };
  }
}

// ─── API Client ──────────────────────────────────────────────────────────────

/** Base URL for API requests — empty when served by Vite/backend, full URL in packaged Electron. */
let _baseUrl = '';
let _baseUrlResolved = false;

async function getBaseUrl(): Promise<string> {
  if (_baseUrlResolved) return _baseUrl;
  if (window.electronAPI?.getBackendUrl && window.location.protocol === 'file:') {
    _baseUrl = await window.electronAPI.getBackendUrl();
  }
  _baseUrlResolved = true;
  return _baseUrl;
}

export async function getApiBaseUrl(): Promise<string> {
  return getBaseUrl();
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${url}`, options);
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

export function startGaiaPairing(cookies: Record<string, string>): Promise<GaiaPairResponse> {
  return request<GaiaPairResponse>('/api/pair/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies }),
  });
}

export function deleteConversation(convId: string): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(convId)}`, { method: 'DELETE' });
}

export function archiveConversation(convId: string, archive: boolean): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(convId)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archive }),
  });
}

export function muteConversation(convId: string, mute: boolean): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(convId)}/mute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mute }),
  });
}

export function blockConversation(convId: string, block: boolean): Promise<void> {
  return request<void>(`/api/conversations/${encodeURIComponent(convId)}/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block }),
  });
}

export function deleteMessage(messageId: string): Promise<void> {
  return request<void>(`/api/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
}

export function avatarUrl(participantId: string): string {
  return `${_baseUrl}/api/avatars/${encodeURIComponent(participantId)}`;
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
  return `${_baseUrl}/api/media?messageId=${encodeURIComponent(messageId)}&mediaId=${encodeURIComponent(mediaId)}`;
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

export function setTyping(conversationId: string): Promise<void> {
  return request<void>('/api/typing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  });
}

export function sendMultiMedia(convId: string, files: File[], replyToId?: string): Promise<SendMessageResponse> {
  const form = new FormData();
  form.append('conversationId', convId);
  for (const file of files) {
    form.append('files', file);
  }
  if (replyToId) form.append('replyToId', replyToId);
  return request<SendMessageResponse>('/api/messages/media', {
    method: 'POST',
    body: form,
  });
}

export function getSendReadReceipts(): boolean {
  return localStorage.getItem('sendReadReceipts') !== 'false';
}

export function setSendReadReceipts(value: boolean): void {
  localStorage.setItem('sendReadReceipts', String(value));
}

export function markRead(convId: string, msgId: string): Promise<void> {
  const sendReceipt = getSendReadReceipts();
  const body = { conversationId: convId, messageId: msgId, sendReceipt };
  return request<void>('/api/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createConversation(numbers: string[]): Promise<Conversation> {
  return request<Conversation>('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numbers }),
  });
}

export function getConversationDetails(convId: string): Promise<Conversation> {
  return request<Conversation>(`/api/conversations/${encodeURIComponent(convId)}/details`);
}

export function fetchContacts(): Promise<ContactsResponse> {
  return request<ContactsResponse>('/api/contacts');
}

export function searchContacts(query: string): Promise<ContactsResponse> {
  return request<ContactsResponse>(`/api/contacts/search?q=${encodeURIComponent(query)}`);
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

// Link Previews

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
  faviconUrl: string;
  domain: string;
}

export function fetchLinkPreview(url: string): Promise<LinkPreview> {
  return request<LinkPreview>(`/api/link-preview?url=${encodeURIComponent(url)}`);
}

export function fetchConversationMedia(convId: string, cursor?: string): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return request<MessagesResponse>(`/api/conversations/${convId}/media${qs ? `?${qs}` : ''}`);
}
