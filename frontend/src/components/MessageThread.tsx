import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import type { Message, Conversation, WsNewMessage, WsMessageUpdate, WsMessageStatus, WsTyping } from '../api/client';
import { fetchMessages, sendMessage, sendMedia, sendReaction, markRead, requestFullSizeImage } from '../api/client';
import MessageBubble from './MessageBubble';
import ImageStack from './ImageStack';
import ImageLightbox, { type LightboxImage } from './ImageLightbox';
import { getMediaUrl } from './MediaPlayer';

interface MessageThreadProps {
  conversationId: string;
  conversation: Conversation | undefined;
  subscribe: (eventType: 'new_message' | 'message_update' | 'message_status' | 'typing', callback: (data: unknown) => void) => () => void;
  targetMessageId?: string | null;
  onTargetReached?: () => void;
}

function dateSeparatorLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.toDateString() === d2.toDateString();
}

// In-memory cache so switching back to a conversation is instant
const messageCache = new Map<string, { messages: Message[]; cursor: string | null; hasMore: boolean }>();

export default function MessageThread({ conversationId, conversation, subscribe, targetMessageId, onTargetReached }: MessageThreadProps) {
  const cached = messageCache.get(conversationId);
  const [messages, setMessages] = useState<Message[]>(cached?.messages ?? []);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [cursor, setCursor] = useState<string | null>(cached?.cursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialLoadRef = useRef(cached ? true : false);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load messages on conversation change
  useEffect(() => {
    let cancelled = false;
    setReplyTo(null);
    setText('');
    setTypingNames([]);

    const cached = messageCache.get(conversationId);
    if (cached) {
      // Restore from cache instantly
      setMessages(cached.messages);
      setCursor(cached.cursor);
      setHasMore(cached.hasMore);
      initialLoadRef.current = true;
    } else {
      // Fresh load
      setMessages([]);
      setCursor(null);
      setHasMore(true);
      initialLoadRef.current = false;
    }

    // Always fetch fresh data (but cached view shows immediately)
    fetchMessages(conversationId).then((res) => {
      if (cancelled) return;
      setMessages(res.messages);
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
      initialLoadRef.current = true;

      // Update cache
      messageCache.set(conversationId, {
        messages: res.messages,
        cursor: res.nextCursor,
        hasMore: res.nextCursor !== null,
      });

      // Mark last message as read
      if (res.messages.length > 0) {
        const last = res.messages[res.messages.length - 1];
        if (!last.sender.isMe) {
          markRead(conversationId, last.id).catch(() => {});
        }
      }
    }).catch(() => {});

    // Auto-focus the input when switching conversations
    textareaRef.current?.focus();

    return () => { cancelled = true; };
  }, [conversationId]);

  // Scroll to bottom after initial load or conversation switch
  useEffect(() => {
    if (initialLoadRef.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    }
  }, [conversationId, messages.length > 0 && initialLoadRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to target message (from search)
  useEffect(() => {
    if (!targetMessageId || messages.length === 0) return;

    const found = messages.find((m) => m.id === targetMessageId);
    if (found) {
      // Target is in loaded messages — scroll to it
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector(`[data-message-id="${targetMessageId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedId(targetMessageId);
          setTimeout(() => setHighlightedId(null), 2000);
        }
        onTargetReached?.();
      });
      return;
    }

    // Target not loaded yet — load older pages until we find it
    if (!hasMore || !cursor || loadingMore) return;

    let cancelled = false;
    let currentCursor = cursor;
    let accumulated = [...messages];

    const loadUntilFound = async () => {
      for (let i = 0; i < 10; i++) {
        if (cancelled || !currentCursor) break;
        try {
          const res = await fetchMessages(conversationId, currentCursor);
          accumulated = [...res.messages, ...accumulated];
          currentCursor = res.nextCursor;

          if (res.messages.some((m) => m.id === targetMessageId)) {
            if (!cancelled) {
              setMessages(accumulated);
              setCursor(currentCursor);
              setHasMore(currentCursor !== null);
              messageCache.set(conversationId, {
                messages: accumulated,
                cursor: currentCursor,
                hasMore: currentCursor !== null,
              });
            }
            return;
          }

          if (!res.nextCursor) break;
        } catch {
          break;
        }
      }
      // Not found after loading — clear target
      if (!cancelled) onTargetReached?.();
    };

    loadUntilFound();
    return () => { cancelled = true; };
  }, [targetMessageId, messages, conversationId, cursor, hasMore, loadingMore, onTargetReached]);

  // WebSocket subscriptions
  useEffect(() => {
    const unsubMsg = subscribe('new_message', (data) => {
      const msg = data as WsNewMessage['data'];
      if (msg.conversationId === conversationId) {
        setMessages((prev) => {
          // If message already exists (e.g. reaction update), replace it in place
          const existingIdx = prev.findIndex((m) => m.id === msg.id);
          let updated: Message[];
          if (existingIdx !== -1) {
            updated = prev.map((m) => (m.id === msg.id ? msg : m));
          } else {
            updated = [...prev, msg];
          }
          const cachedEntry = messageCache.get(conversationId);
          messageCache.set(conversationId, {
            messages: updated,
            cursor: cachedEntry?.cursor ?? null,
            hasMore: cachedEntry?.hasMore ?? true,
          });
          return updated;
        });
        if (!msg.sender.isMe) {
          markRead(conversationId, msg.id).catch(() => {});
        }
        setTimeout(scrollToBottom, 50);
      }
    });

    // message_update: reaction changes, edits — update in place, no scroll, no markRead
    const unsubUpdate = subscribe('message_update', (data) => {
      const msg = data as WsMessageUpdate['data'];
      if (msg.conversationId === conversationId) {
        setMessages((prev) => {
          const updated = prev.map((m) => (m.id === msg.id ? msg : m));
          const cachedEntry = messageCache.get(conversationId);
          messageCache.set(conversationId, {
            messages: updated,
            cursor: cachedEntry?.cursor ?? null,
            hasMore: cachedEntry?.hasMore ?? true,
          });
          return updated;
        });
      }
    });

    const unsubStatus = subscribe('message_status', (data) => {
      const s = data as WsMessageStatus['data'];
      if (s.conversationId === conversationId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === s.messageId ? { ...m, status: s.status } : m))
        );
      }
    });

    const unsubTyping = subscribe('typing', (data) => {
      const t = data as WsTyping['data'];
      if (t.conversationId !== conversationId) return;

      if (t.active) {
        const name = t.name || conversation?.participants.find((p) => p.id === t.participantId)?.name || 'Someone';
        setTypingNames((prev) => (prev.includes(name) ? prev : [...prev, name]));

        // Clear after 5s
        const existing = typingTimersRef.current.get(t.participantId);
        if (existing) clearTimeout(existing);
        typingTimersRef.current.set(
          t.participantId,
          setTimeout(() => {
            setTypingNames((prev) => prev.filter((n) => n !== name));
            typingTimersRef.current.delete(t.participantId);
          }, 5000)
        );
      } else {
        const name = t.name || conversation?.participants.find((p) => p.id === t.participantId)?.name || 'Someone';
        setTypingNames((prev) => prev.filter((n) => n !== name));
        const existing = typingTimersRef.current.get(t.participantId);
        if (existing) {
          clearTimeout(existing);
          typingTimersRef.current.delete(t.participantId);
        }
      }
    });

    return () => {
      unsubMsg();
      unsubUpdate();
      unsubStatus();
      unsubTyping();
      typingTimersRef.current.forEach((timer) => clearTimeout(timer));
      typingTimersRef.current.clear();
    };
  }, [conversationId, conversation, subscribe, scrollToBottom]);

  // Load more on scroll to top
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingMore || !hasMore || !cursor) return;

    if (el.scrollTop < 100) {
      setLoadingMore(true);
      const prevHeight = el.scrollHeight;

      fetchMessages(conversationId, cursor).then((res) => {
        setMessages((prev) => [...res.messages, ...prev]);
        setCursor(res.nextCursor);
        setHasMore(res.nextCursor !== null);
        setLoadingMore(false);

        // Maintain scroll position
        requestAnimationFrame(() => {
          if (el) {
            el.scrollTop = el.scrollHeight - prevHeight;
          }
        });
      }).catch(() => setLoadingMore(false));
    }
  }, [conversationId, cursor, hasMore, loadingMore]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    sendMessage(conversationId, trimmed, replyTo?.id).catch(() => {});
    setText('');
    setReplyTo(null);
    setTimeout(scrollToBottom, 100);
  }, [conversationId, text, replyTo, scrollToBottom]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    sendMedia(conversationId, file, replyTo?.id).catch(() => {});
    setReplyTo(null);
    e.target.value = '';
    setTimeout(scrollToBottom, 100);
  };

  const handleReply = useCallback((msg: Message) => {
    setReplyTo(msg);
  }, []);

  const handleReact = useCallback((msgId: string, emoji: string) => {
    sendReaction(conversationId, msgId, emoji).catch(() => {});
  }, [conversationId]);

  // Collect all images across messages for the lightbox
  const allImages = useMemo<LightboxImage[]>(() => {
    const imgs: LightboxImage[] = [];
    for (const msg of messages) {
      for (const media of msg.media) {
        if (media.mimeType.startsWith('image/')) {
          imgs.push({
            url: getMediaUrl(media, msg.id),
            messageId: msg.id,
            senderName: msg.sender.name,
            timestamp: msg.timestamp,
            isThumbnail: media.isThumbnail,
            actionMessageId: media.actionMessageId,
          });
        }
      }
    }
    return imgs;
  }, [messages]);

  // Track which full-size images we've already requested
  const fullSizeRequestedRef = useRef<Set<string>>(new Set());
  const [loadingFullSize, setLoadingFullSize] = useState(false);

  const handleImageClick = useCallback(
    (url: string) => {
      const idx = allImages.findIndex((img) => img.url === url);
      if (idx !== -1) {
        setLightboxIndex(idx);
        // Request full-size if this is a thumbnail
        const img = allImages[idx];
        if (img.isThumbnail && img.actionMessageId) {
          const key = `${img.messageId}:${img.actionMessageId}`;
          if (!fullSizeRequestedRef.current.has(key)) {
            fullSizeRequestedRef.current.add(key);
            setLoadingFullSize(true);
            requestFullSizeImage(img.messageId, img.actionMessageId).catch(() => {});
          }
        }
      }
    },
    [allImages]
  );

  // When navigating in the lightbox, request full-size for the new image
  const handleLightboxNavigate = useCallback(
    (idx: number) => {
      setLightboxIndex(idx);
      const img = allImages[idx];
      if (img?.isThumbnail && img.actionMessageId) {
        const key = `${img.messageId}:${img.actionMessageId}`;
        if (!fullSizeRequestedRef.current.has(key)) {
          fullSizeRequestedRef.current.add(key);
          setLoadingFullSize(true);
          requestFullSizeImage(img.messageId, img.actionMessageId).catch(() => {});
        }
      }
    },
    [allImages]
  );

  // Clear loading state when the image URL changes (full-size arrived via WS update)
  useEffect(() => {
    if (lightboxIndex !== null && allImages[lightboxIndex] && !allImages[lightboxIndex].isThumbnail) {
      setLoadingFullSize(false);
    }
  }, [lightboxIndex, allImages]);

  // Helper: is this message image-only (has images, no text)?
  const isImageOnly = (msg: Message) =>
    !msg.text && !msg.isSystemMessage && msg.media.length > 0 && msg.media.every((m) => m.mimeType.startsWith('image/'));

  // Build messages with date separators, grouping consecutive image-only messages
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    const newDay = !prev || !isSameDay(prev.timestamp, msg.timestamp);
    if (newDay) {
      elements.push(
        <div key={`sep-${msg.timestamp}`} className="flex items-center justify-center my-4">
          <span className="text-xs text-gray-500 bg-[#1a1a2e] px-3 py-1 rounded-full">
            {dateSeparatorLabel(msg.timestamp)}
          </span>
        </div>
      );
    }

    const showSender = newDay || !prev || prev.sender.id !== msg.sender.id;

    // Check if this starts a group of consecutive image-only messages from the same sender
    if (isImageOnly(msg)) {
      const group: Message[] = [msg];
      let j = i + 1;
      while (
        j < messages.length &&
        isImageOnly(messages[j]) &&
        messages[j].sender.id === msg.sender.id &&
        isSameDay(msg.timestamp, messages[j].timestamp)
      ) {
        group.push(messages[j]);
        j++;
      }

      if (group.length >= 2) {
        // Render as a stacked image group
        elements.push(
          <div key={`stack-${msg.id}`} data-message-id={msg.id}>
            <ImageStack
              messages={group}
              isMe={msg.sender.isMe}
              showSender={showSender}
              onImageClick={handleImageClick}
            />
          </div>
        );
        i = j;
        continue;
      }
    }

    // Regular single message
    elements.push(
      <div
        key={msg.id}
        data-message-id={msg.id}
        className={`transition-colors duration-1000 rounded-lg ${highlightedId === msg.id ? 'bg-[#4361ee]/20' : ''}`}
      >
        <MessageBubble
          message={msg}
          isMe={msg.sender.isMe}
          showSender={showSender}
          onReply={handleReply}
          onReact={handleReact}
          onImageClick={handleImageClick}
        />
      </div>
    );
    i++;
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Draggable title bar region */}
      <div className="titlebar-drag h-12 flex-shrink-0 border-b border-[#2a2a3e] bg-[#1a1a2e] flex items-center px-4 gap-3">
        {conversation && (
          <>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0"
              style={{ backgroundColor: conversation.participants[0]?.avatarColor ?? '#4361ee' }}
            >
              {conversation.name
                .split(' ')
                .map((w) => w[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#e2e8f0]">{conversation.name}</h2>
              {conversation.isGroup && (
                <p className="text-xs text-gray-500">
                  {conversation.participants.map((p) => p.name).join(', ')}
                </p>
              )}
            </div>
          </>
        )}
      </div>


      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        {loadingMore && (
          <div className="text-center text-gray-500 text-xs py-2">Loading older messages...</div>
        )}
        {elements}
        {typingNames.length > 0 && (
          <div className="text-xs text-gray-400 mb-2 ml-1">
            {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply preview */}
      {replyTo && (
        <div className="px-4 py-2 border-t border-[#2a2a3e] bg-[#1a1a2e] flex items-center gap-2">
          <div className="flex-1 border-l-2 border-[#4361ee] pl-2 min-w-0">
            <span className="text-xs font-medium text-[#4361ee]">{replyTo.sender.name}</span>
            <p className="text-xs text-gray-400 truncate">{replyTo.text}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-gray-200 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-[#2a2a3e] bg-[#1a1a2e] flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-gray-400 hover:text-gray-200 transition-colors rounded-lg hover:bg-[#2a2a3e]"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 bg-[#0f0f1a] text-[#e2e8f0] text-sm px-4 py-2.5 rounded-lg border border-[#2a2a3e] focus:border-[#4361ee] focus:outline-none resize-none placeholder-gray-500 transition-colors"
          style={{ maxHeight: '120px' }}
        />

        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="p-2 text-[#4361ee] hover:bg-[#4361ee]/10 transition-colors rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>

      {/* Image lightbox */}
      {lightboxIndex !== null && (
        <ImageLightbox
          images={allImages}
          currentIndex={lightboxIndex}
          onClose={() => { setLightboxIndex(null); setLoadingFullSize(false); }}
          onNavigate={handleLightboxNavigate}
          loadingFullSize={loadingFullSize}
        />
      )}
    </div>
  );
}
