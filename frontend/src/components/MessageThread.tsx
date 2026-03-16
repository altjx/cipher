import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Paperclip, X, Search, MoreVertical, Smile, Info, Clock } from 'lucide-react';
import type { Message, Conversation, WsNewMessage, WsMessageUpdate, WsMessageStatus, WsTyping } from '../api/client';
import { fetchMessages, sendMessage, sendMedia, sendMultiMedia, sendReaction, markRead, requestFullSizeImage, setTyping, deleteMessage } from '../api/client';
import MessageBubble from './MessageBubble';
import { avatarGradient, senderColor } from '../utils/avatarGradient';
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
  subscribe: (eventType: 'new_message' | 'messages_refreshed' | 'message_update' | 'message_status' | 'typing', callback: (data: unknown) => void) => () => void;
  targetMessageId?: string | null;
  onTargetReached?: () => void;
  detailOpen: boolean;
  onToggleDetail: () => void;
  onShowParticipantDetail: (participantId: string) => void;
  searchTrigger?: number;
  refocusTrigger?: number;
  emojiInsert?: { emoji: string; seq: number };
  reactionEmoji?: { emoji: string; seq: number };
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

export default function MessageThread({ conversationId, conversation, subscribe, targetMessageId, onTargetReached, detailOpen, onToggleDetail, onShowParticipantDetail: _onShowParticipantDetail, searchTrigger, refocusTrigger, emojiInsert, reactionEmoji }: MessageThreadProps) {
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
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [scrollGeneration, setScrollGeneration] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const refreshedRef = useRef(false);
  const lastTypingSentRef = useRef<number>(0);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // When an image finishes loading, re-scroll if the user is near the bottom.
  // This prevents layout shifts from pushing the viewport up after the initial scroll.
  const handleImageLoad = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 400) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    }
  }, []);

  // When the typing indicator appears, scroll it into view if the user is near the bottom.
  useEffect(() => {
    if (typingNames.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 150) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [typingNames.length > 0]);

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

  // Open search when triggered externally (Cmd+F)
  useEffect(() => {
    if (searchTrigger && searchTrigger > 0) {
      setShowSearch(true);
      setSearchQuery('');
      // Focus happens via the showSearch effect above
    }
  }, [searchTrigger]);

  // Refocus textarea when triggered (e.g. after closing spotlight)
  useEffect(() => {
    if (refocusTrigger && refocusTrigger > 0) {
      textareaRef.current?.focus();
    }
  }, [refocusTrigger]);

  // Insert emoji at cursor via keyboard shortcut (Cmd+1-7)
  useEffect(() => {
    if (!emojiInsert || emojiInsert.seq === 0) return;
    handleEmojiSelect(emojiInsert.emoji);
  }, [emojiInsert?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to last non-me message via keyboard shortcut (Cmd+X+1-7) — toggles if already applied
  useEffect(() => {
    if (!reactionEmoji || reactionEmoji.seq === 0) return;
    const meId = conversation?.participants.find((p) => p.isMe)?.id;
    // Find the last message from someone else
    for (let idx = messages.length - 1; idx >= 0; idx--) {
      if (!messages[idx].sender.isMe) {
        const msg = messages[idx];
        const existing = meId && msg.reactions.find((r) => r.emoji === reactionEmoji.emoji && r.senderIds.includes(meId));
        // Toggle: remove if already applied, add otherwise
        const emoji = existing ? '' : reactionEmoji.emoji;
        sendReaction(conversationId, msg.id, emoji).catch(() => {});
        break;
      }
    }
  }, [reactionEmoji?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Scroll to bottom immediately for cached conversations
      setScrollGeneration((g) => g + 1);
    } else {
      setMessages([]);
      setCursor(null);
      setHasMore(true);
    }

    // Reset: background refresh hasn't arrived yet for this load cycle
    refreshedRef.current = false;

    fetchMessages(conversationId).then((res) => {
      if (cancelled) return;
      // Skip if messages_refreshed already arrived with fresher data
      if (refreshedRef.current) return;

      setMessages(res.messages);
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
      // Always scroll to bottom when fresh data arrives
      setScrollGeneration((g) => g + 1);

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
    if (messages.length === 0) return;
    // Use rAF to let the browser lay out content (especially images with explicit dimensions)
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    });
  }, [scrollGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Background refresh completed — replace stale messages with fresh data
    const unsubRefreshed = subscribe('messages_refreshed', (data) => {
      const d = data as { conversationId: string; messages: Message[]; nextCursor: string };
      if (d.conversationId === conversationId) {
        refreshedRef.current = true;
        setMessages(d.messages);
        setCursor(d.nextCursor || null);
        setHasMore(!!d.nextCursor);
        messageCache.set(conversationId, {
          messages: d.messages,
          cursor: d.nextCursor || null,
          hasMore: !!d.nextCursor,
        });
        if (d.messages.length > 0) {
          const last = d.messages[d.messages.length - 1];
          if (!last.sender.isMe) {
            markRead(conversationId, last.id).catch(() => {});
          }
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
      unsubRefreshed();
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
    const hasFiles = stagedFiles.length > 0;

    if (!trimmed && !hasFiles) return;

    if (hasFiles) {
      if (stagedFiles.length === 1) {
        sendMedia(conversationId, stagedFiles[0], replyTo?.id).catch(() => {});
      } else {
        sendMultiMedia(conversationId, stagedFiles, replyTo?.id).catch(() => {});
      }
      setStagedFiles([]);
      // Also send text if provided alongside files
      if (trimmed) {
        sendMessage(conversationId, trimmed, replyTo?.id).catch(() => {});
      }
    } else {
      sendMessage(conversationId, trimmed, replyTo?.id).catch(() => {});
    }

    setText('');
    setReplyTo(null);
    // Reset textarea height after clearing
    if (textareaRef.current) textareaRef.current.style.height = '';
    setTimeout(scrollToBottom, 100);
  }, [conversationId, text, stagedFiles, replyTo, scrollToBottom]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (files.length > 0) {
      e.preventDefault();
      setStagedFiles((prev) => [...prev, ...files]);
    }
  }, []);

  const autoResizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    autoResizeTextarea();
    if (e.target.value) {
      const now = Date.now();
      if (now - lastTypingSentRef.current > 3000) {
        lastTypingSentRef.current = now;
        setTyping(conversationId).catch(() => {});
      }
    }
  }, [conversationId, autoResizeTextarea]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setStagedFiles((prev) => [...prev, ...files]);
    e.target.value = '';
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (files.length > 0) {
      setStagedFiles((prev) => [...prev, ...files]);
    }
  }, []);

  const removeStagedFile = useCallback((index: number) => {
    setStagedFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next;
    });
  }, []);

  const handleReply = useCallback((msg: Message) => {
    setReplyTo(msg);
  }, []);

  const handleReact = useCallback((msgId: string, emoji: string) => {
    sendReaction(conversationId, msgId, emoji).catch(() => {});
  }, [conversationId]);

  const handleRemoveReaction = useCallback((msgId: string, _emoji: string) => {
    sendReaction(conversationId, msgId, '').catch(() => {});
  }, [conversationId]);

  const handleDeleteMessage = useCallback((msgId: string) => {
    deleteMessage(msgId).then(() => {
      setMessages((prev) => {
        const updated = prev.filter((m) => m.id !== msgId);
        const cachedEntry = messageCache.get(conversationId);
        messageCache.set(conversationId, {
          messages: updated,
          cursor: cachedEntry?.cursor ?? null,
          hasMore: cachedEntry?.hasMore ?? true,
        });
        return updated;
      });
    }).catch(() => {});
  }, [conversationId]);

  const handleResend = useCallback((msg: Message) => {
    // Re-send as a new message with the same content
    if (msg.text) {
      sendMessage(conversationId, msg.text).catch(() => {});
    }
    // Remove the failed message from the list
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
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

  // Build lightbox images for a set of messages (scoped to the clicked context)
  const buildLightboxImages = useCallback((msgs: Message[]): LightboxImage[] => {
    const imgs: LightboxImage[] = [];
    for (const msg of msgs) {
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
  }, []);

  // Track which full-size images we've already requested
  const fullSizeRequestedRef = useRef<Set<string>>(new Set());
  const [loadingFullSize, setLoadingFullSize] = useState(false);

  const handleImageClick = useCallback(
    (url: string, scopedImages: LightboxImage[]) => {
      const idx = scopedImages.findIndex((img) => img.url === url);
      if (idx !== -1) {
        setLightboxImages(scopedImages);
        setLightboxIndex(idx);
        const img = scopedImages[idx];
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
    []
  );

  const handleLightboxNavigate = useCallback(
    (idx: number) => {
      setLightboxIndex(idx);
      const img = lightboxImages[idx];
      if (img?.isThumbnail && img.actionMessageId) {
        const key = `${img.messageId}:${img.actionMessageId}`;
        if (!fullSizeRequestedRef.current.has(key)) {
          fullSizeRequestedRef.current.add(key);
          setLoadingFullSize(true);
          requestFullSizeImage(img.messageId, img.actionMessageId).catch(() => {});
        }
      }
    },
    [lightboxImages]
  );

  // Clear loading state when the image URL changes (full-size arrived via WS update)
  useEffect(() => {
    if (lightboxIndex !== null && lightboxImages[lightboxIndex] && !lightboxImages[lightboxIndex].isThumbnail) {
      setLoadingFullSize(false);
    }
  }, [lightboxIndex, lightboxImages]);

  // Keep lightbox images in sync when messages update (e.g. full-size image arrives via WS)
  useEffect(() => {
    if (lightboxIndex === null || lightboxImages.length === 0) return;
    const currentImg = lightboxImages[lightboxIndex];
    if (!currentImg) return;
    // Find the source message and rebuild the URL in case media was updated
    const msg = messages.find((m) => m.id === currentImg.messageId);
    if (!msg) return;
    const updatedImages = lightboxImages.map((img) => {
      const srcMsg = messages.find((m) => m.id === img.messageId);
      if (!srcMsg) return img;
      for (const media of srcMsg.media) {
        if (media.mimeType.startsWith('image/')) {
          const url = getMediaUrl(media, srcMsg.id);
          if (media.actionMessageId === img.actionMessageId || url === img.url) {
            return { ...img, url, isThumbnail: media.isThumbnail };
          }
        }
      }
      return img;
    });
    // Only update if something actually changed
    if (updatedImages.some((img, i) => img.url !== lightboxImages[i].url || img.isThumbnail !== lightboxImages[i].isThumbnail)) {
      setLightboxImages(updatedImages);
    }
  }, [messages, lightboxIndex, lightboxImages]);

  // Helper: is this message image-only (has images, no text)?
  const isImageOnly = (msg: Message) =>
    !msg.text && !msg.isSystemMessage && msg.media.length > 0 && msg.media.every((m) => m.mimeType.startsWith('image/'));

  // Participant names for subtitle
  const otherParticipants = conversation?.participants.filter((p) => !p.isMe) ?? [];
  const subtitleText = conversation?.isGroup
    ? otherParticipants.map((p) => p.name).join(', ')
    : 'RCS';

  const myParticipantId = useMemo(() => conversation?.participants.find((p) => p.isMe)?.id, [conversation]);

  // Map sender IDs to colors for group chats
  const senderColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!conversation?.isGroup) return map;
    for (const p of conversation.participants) {
      if (!p.isMe) {
        map.set(p.id, senderColor(p.name));
      }
    }
    return map;
  }, [conversation]);

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
        const stackImages = buildLightboxImages(group);
        elements.push(
          <div key={`stack-${msg.id}`} data-message-id={msg.id} className={isSearchMatch ? '' : 'opacity-25'}>
            <ImageStack
              messages={group}
              isMe={msg.sender.isMe}
              showSender={showSender}
              onImageClick={(url) => handleImageClick(url, stackImages)}
              isGroup={conversation?.isGroup}
              senderColor={senderColorMap.get(msg.sender.id)}
            />
          </div>
        );
        i = j;
        continue;
      }
    }

    // Regular single message
    const msgImages = buildLightboxImages([msg]);
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
          onRemoveReaction={handleRemoveReaction}
          myParticipantId={myParticipantId}
          onDelete={msg.sender.isMe ? handleDeleteMessage : undefined}
          onResend={msg.sender.isMe && msg.status === 'failed' ? handleResend : undefined}
          onImageClick={msgImages.length > 0 ? (url: string) => handleImageClick(url, msgImages) : undefined}
          onImageLoad={handleImageLoad}
          conversationName={conversation?.name}
          showTimestamp={showTimestamps}
          isGroup={conversation?.isGroup}
          senderColor={senderColorMap.get(msg.sender.id)}
        />
      </div>
    );
    i++;
  }

  return (
    <div
      className="flex-1 flex flex-col h-full min-w-0 bg-[var(--surface-1)] rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag & drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--surface-1)]/80 backdrop-blur-sm border-2 border-dashed border-[var(--accent)] rounded-[20px] pointer-events-none">
          <div className="text-center">
            <p className="text-lg font-semibold text-[var(--accent)]">Drop images here</p>
            <p className="text-sm text-[var(--text-2)] mt-1">Images and videos will be staged for sending</p>
          </div>
        </div>
      )}

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
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowSearch(false);
                setSearchQuery('');
                textareaRef.current?.focus();
              }
            }}
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
        onKeyDown={(e) => {
          if (e.key === 'PageDown' || e.key === 'PageUp') {
            e.preventDefault();
            const el = scrollRef.current;
            if (!el) return;
            const delta = el.clientHeight * 0.85;
            el.scrollBy({ top: e.key === 'PageDown' ? delta : -delta, behavior: 'smooth' });
          }
        }}
        tabIndex={-1}
        className="flex-1 overflow-y-auto px-6 py-5 focus:outline-none"
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

      {/* Staged files preview */}
      {stagedFiles.length > 0 && (
        <div className="px-5 py-2 border-t border-[var(--border)] flex items-center gap-2 overflow-x-auto">
          {stagedFiles.map((file, i) => (
            <div key={`${file.name}-${i}`} className="relative flex-shrink-0 group">
              {file.type.startsWith('image/') ? (
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="w-16 h-16 object-cover rounded-lg border border-[var(--border)]"
                  onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                />
              ) : (
                <div className="w-16 h-16 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-center">
                  <span className="text-[10px] text-[var(--text-3)] text-center px-1 truncate">{file.name}</span>
                </div>
              )}
              <button
                onClick={() => removeStagedFile(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[var(--surface-2)] border border-[var(--border)] rounded-full flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
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
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 bg-transparent text-[var(--text)] text-sm py-2 px-2 focus:outline-none resize-none placeholder-[var(--text-3)] font-[inherit] min-h-[36px] overflow-y-auto"
            style={{ maxHeight: '120px' }}
          />

          <div className="relative">
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              className="w-9 h-9 rounded-[10px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors flex items-center justify-center flex-shrink-0"
            >
              <Smile className="w-[17px] h-[17px]" />
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-2 z-50">
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
          disabled={!text.trim() && stagedFiles.length === 0}
          className="w-11 h-11 rounded-[14px] bg-[var(--accent-2)] text-white flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 shadow-[0_2px_8px_rgba(59,130,246,0.25)] hover:shadow-[0_4px_16px_rgba(59,130,246,0.35)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          <Send className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Image lightbox */}
      {lightboxIndex !== null && (
        <ImageLightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => { setLightboxIndex(null); setLightboxImages([]); setLoadingFullSize(false); }}
          onNavigate={handleLightboxNavigate}
          loadingFullSize={loadingFullSize}
        />
      )}
    </div>
  );
}
