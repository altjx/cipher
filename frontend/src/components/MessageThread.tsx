import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Paperclip, X, Search, MoreVertical, Smile, Info, Clock } from 'lucide-react';
import type { Message, Conversation, WsNewMessage, WsMessageUpdate, WsMessageStatus, WsTyping } from '../api/client';
import { fetchMessages, sendMessage, sendMedia, sendReaction, markRead, requestFullSizeImage } from '../api/client';
import MessageBubble from './MessageBubble';
import { avatarGradient } from '../utils/avatarGradient';
import ImageStack from './ImageStack';
import ImageLightbox, { type LightboxImage } from './ImageLightbox';
import { getMediaUrl } from './MediaPlayer';
import EmojiPicker from './EmojiPicker';

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function getInitials(name: string): string {
  return name
    .replace(EMOJI_RE, '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface MessageThreadProps {
  conversationId: string;
  conversation: Conversation | undefined;
  subscribe: (eventType: 'new_message' | 'message_update' | 'message_status' | 'typing', callback: (data: unknown) => void) => () => void;
  targetMessageId?: string | null;
  onTargetReached?: () => void;
  detailOpen: boolean;
  onToggleDetail: () => void;
  onShowParticipantDetail: (participantId: string) => void;
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

export default function MessageThread({ conversationId, conversation, subscribe, targetMessageId, onTargetReached, detailOpen, onToggleDetail, onShowParticipantDetail: _onShowParticipantDetail }: MessageThreadProps) {
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialLoadRef = useRef(cached ? true : false);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  // Focus search input when opened
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  // Load messages on conversation change
  useEffect(() => {
    let cancelled = false;
    setReplyTo(null);
    setText('');
    setTypingNames([]);
    setShowEmojiPicker(false);
    setShowSearch(false);
    setSearchQuery('');
    setShowMenu(false);

    const cached = messageCache.get(conversationId);
    if (cached) {
      setMessages(cached.messages);
      setCursor(cached.cursor);
      setHasMore(cached.hasMore);
      initialLoadRef.current = true;
    } else {
      setMessages([]);
      setCursor(null);
      setHasMore(true);
      initialLoadRef.current = false;
    }

    fetchMessages(conversationId).then((res) => {
      if (cancelled) return;
      setMessages(res.messages);
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
      initialLoadRef.current = true;

      messageCache.set(conversationId, {
        messages: res.messages,
        cursor: res.nextCursor,
        hasMore: res.nextCursor !== null,
      });

      if (res.messages.length > 0) {
        const last = res.messages[res.messages.length - 1];
        if (!last.sender.isMe) {
          markRead(conversationId, last.id).catch(() => {});
        }
      }
    }).catch(() => {});

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

    if (!hasMore || !cursor || loadingMore) return;

    let cancelled = false;
    let currentCursor: string | null = cursor;
    let accumulated = [...messages];

    const loadUntilFound = async () => {
      for (let i = 0; i < 10; i++) {
        if (cancelled || !currentCursor) break;
        try {
          const res = await fetchMessages(conversationId, currentCursor);
          accumulated = [...res.messages, ...accumulated];
          currentCursor = res.nextCursor ?? null;

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

  const handleEmojiSelect = useCallback((emoji: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newText = text.slice(0, start) + emoji + text.slice(end);
      setText(newText);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setText((prev) => prev + emoji);
    }
    setShowEmojiPicker(false);
  }, [text]);

  // Filter messages by search query
  const searchLower = searchQuery.toLowerCase();
  const matchingIds = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.text.toLowerCase().includes(searchLower)) {
        ids.add(msg.id);
      }
    }
    return ids;
  }, [messages, searchLower, searchQuery]);

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

  // Participant names for subtitle
  const otherParticipants = conversation?.participants.filter((p) => !p.isMe) ?? [];
  const subtitleText = conversation?.isGroup
    ? otherParticipants.map((p) => p.name).join(', ')
    : 'RCS';

  // Build messages with date separators, grouping consecutive image-only messages
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    const isSearchMatch = matchingIds === null || matchingIds.has(msg.id);

    const newDay = !prev || !isSameDay(prev.timestamp, msg.timestamp);
    if (newDay) {
      elements.push(
        <div key={`sep-${msg.timestamp}`} className="flex items-center justify-center my-4">
          <span className="text-[11px] font-medium text-[var(--text-3)] bg-[var(--surface-2)] px-3.5 py-1 rounded-lg">
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
        elements.push(
          <div key={`stack-${msg.id}`} data-message-id={msg.id} className={isSearchMatch ? '' : 'opacity-25'}>
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
        className={`transition-all duration-300 rounded-lg ${highlightedId === msg.id ? 'bg-[var(--accent)]/20' : ''} ${isSearchMatch ? '' : 'opacity-25'}`}
      >
        <MessageBubble
          message={msg}
          isMe={msg.sender.isMe}
          showSender={showSender}
          onReply={handleReply}
          onReact={handleReact}
          onImageClick={handleImageClick}
          conversationName={conversation?.name}
          showTimestamp={showTimestamps}
        />
      </div>
    );
    i++;
  }

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-[var(--surface-1)] rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden">
      {/* Draggable title bar region */}
      <div className="titlebar-drag flex-shrink-0 border-b border-[var(--border)] flex items-center px-6 gap-3.5" style={{ minHeight: '56px' }}>
        {conversation && (
          <>
            <div
              className="w-[38px] h-[38px] rounded-xl flex items-center justify-center text-white text-[13px] font-semibold flex-shrink-0"
              style={{ background: avatarGradient(conversation.participants[0]?.avatarColor ?? '#3b82f6') }}
            >
              {getInitials(conversation.name)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[var(--text)] truncate">{conversation.name}</h2>
              {conversation.isGroup ? (
                <p
                  className="text-[11px] text-[var(--text-2)] truncate cursor-pointer hover:text-[var(--accent)] transition-colors titlebar-no-drag"
                  onClick={() => onToggleDetail()}
                  title="View participants"
                >
                  {subtitleText}
                </p>
              ) : (
                <p className="text-[11px] text-[var(--text-2)]">{subtitleText}</p>
              )}
            </div>
            <div className="ml-auto flex gap-1 titlebar-no-drag">
              <button
                onClick={() => setShowTimestamps((v) => !v)}
                className={`w-9 h-9 rounded-[10px] transition-all flex items-center justify-center ${
                  showTimestamps
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                }`}
                title="Toggle timestamps"
              >
                <Clock className="w-[15px] h-[15px]" />
              </button>
              <button
                onClick={() => { setShowSearch((v) => !v); setSearchQuery(''); }}
                className={`w-9 h-9 rounded-[10px] transition-all flex items-center justify-center ${
                  showSearch
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                }`}
                title="Search messages"
              >
                <Search className="w-[15px] h-[15px]" />
              </button>
              <button
                onClick={() => onToggleDetail()}
                className={`w-9 h-9 rounded-[10px] transition-all flex items-center justify-center ${
                  detailOpen
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                }`}
                title="Contact info"
              >
                <Info className="w-[15px] h-[15px]" />
              </button>
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu((v) => !v)}
                  className={`w-9 h-9 rounded-[10px] transition-all flex items-center justify-center ${
                    showMenu
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                  }`}
                >
                  <MoreVertical className="w-[15px] h-[15px]" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-lg py-1 min-w-[160px] z-20">
                    <button
                      onClick={() => { onToggleDetail(); setShowMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors"
                    >
                      {detailOpen ? 'Hide info panel' : 'Contact info'}
                    </button>
                    <button
                      onClick={() => { setShowTimestamps((v) => !v); setShowMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors"
                    >
                      {showTimestamps ? 'Hide timestamps' : 'Show timestamps'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Inline search bar */}
      {showSearch && (
        <div className="px-6 py-2 border-b border-[var(--border)] flex items-center gap-2">
          <Search className="w-4 h-4 text-[var(--text-3)] flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search in conversation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder-[var(--text-3)] focus:outline-none"
          />
          {matchingIds !== null && (
            <span className="text-xs text-[var(--text-3)]">{matchingIds.size} found</span>
          )}
          <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="text-[var(--text-3)] hover:text-[var(--text)]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-5"
      >
        {loadingMore && (
          <div className="text-center text-[var(--text-3)] text-xs py-2">Loading older messages...</div>
        )}
        {elements}
        {typingNames.length > 0 && (
          <div className="flex items-center gap-2 mb-2 self-start">
            <div className="bg-[var(--surface-2)] rounded-[18px_18px_18px_6px] px-4 py-2.5 flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-3)]" style={{ animation: 'blink 1.4s ease-in-out infinite' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-3)]" style={{ animation: 'blink 1.4s ease-in-out infinite 0.15s' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-3)]" style={{ animation: 'blink 1.4s ease-in-out infinite 0.3s' }} />
              </div>
              <span className="text-xs text-[var(--text-3)]">
                {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing...
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply preview */}
      {replyTo && (
        <div className="px-6 py-2 border-t border-[var(--border)] flex items-center gap-2">
          <div className="flex-1 border-l-2 border-[var(--accent)] pl-2 min-w-0">
            <span className="text-xs font-medium text-[var(--accent)]">{replyTo.sender.name}</span>
            <p className="text-xs text-[var(--text-2)] truncate">{replyTo.text}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-[var(--text-2)] hover:text-[var(--text)] p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="px-5 py-3 pb-5 border-t border-[var(--border)] flex items-end gap-2.5">
        <div className="flex-1 bg-[var(--surface-2)] rounded-2xl flex items-end px-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 rounded-[10px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors flex items-center justify-center flex-shrink-0"
          >
            <Paperclip className="w-[17px] h-[17px]" />
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
            className="flex-1 bg-transparent text-[var(--text)] text-sm py-2 px-2 focus:outline-none resize-none placeholder-[var(--text-3)] font-[inherit]"
            style={{ maxHeight: '120px', minHeight: '36px' }}
          />

          <div className="relative">
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="w-9 h-9 rounded-[10px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors flex items-center justify-center flex-shrink-0"
            >
              <Smile className="w-[17px] h-[17px]" />
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-2">
                <EmojiPicker
                  onSelect={handleEmojiSelect}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="w-11 h-11 rounded-[14px] bg-[var(--accent-2)] text-white flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 shadow-[0_2px_8px_rgba(59,130,246,0.25)] hover:shadow-[0_4px_16px_rgba(59,130,246,0.35)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          <Send className="w-[18px] h-[18px]" />
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
