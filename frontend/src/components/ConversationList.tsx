import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, MessageCircle, PanelLeftClose, PanelLeftOpen, Trash2, Archive, BellOff, Ban, SquarePen } from 'lucide-react';
import type { Conversation, WsConversationUpdate, WsTyping, SearchResult } from '../api/client';
import { searchMessages, fetchConversations, deleteConversation, archiveConversation, muteConversation, blockConversation } from '../api/client';
import { avatarGradient } from '../utils/avatarGradient';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectMessage: (conversationId: string, messageId: string) => void;
  onConversationsUpdate: (updater: (prev: Conversation[]) => Conversation[]) => void;
  onDeleteConversation: (id: string) => void;
  deletedIds: Set<string>;
  subscribe: (eventType: 'conversation_update' | 'typing', callback: (data: unknown) => void) => () => void;
  phoneStatus: 'connected' | 'offline' | 'reconnecting' | null;
  wsConnected: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  focusSearchTrigger?: number;
  onCompose?: () => void;
}

type TabType = 'all' | 'unread' | 'groups' | 'archived' | 'spam';

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

function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/** Returns a snippet around the first match with the match portion marked. */
function snippet(text: string, query: string): { before: string; match: string; after: string } {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return { before: truncate(text, 50), match: '', after: '' };
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + query.length + 20);
  return {
    before: (start > 0 ? '...' : '') + text.slice(start, idx),
    match: text.slice(idx, idx + query.length),
    after: text.slice(idx + query.length, end) + (end < text.length ? '...' : ''),
  };
}

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onSelectMessage,
  onConversationsUpdate,
  onDeleteConversation,
  deletedIds,
  subscribe,
  phoneStatus,
  wsConnected,
  collapsed,
  onToggleCollapse,
  focusSearchTrigger,
  onCompose,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [archivedConvs, setArchivedConvs] = useState<Conversation[]>([]);
  const [spamConvs, setSpamConvs] = useState<Conversation[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Map of conversationId -> set of typing names
  const [typingMap, setTypingMap] = useState<Map<string, Set<string>>>(new Map());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Refs for scrolling selected conversation into view
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; convId: string; convName: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ convId: string; convName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleContextMenu = useCallback((e: React.MouseEvent, convId: string, convName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, convId, convName });
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await deleteConversation(deleteConfirm.convId);
      onDeleteConversation(deleteConfirm.convId);
    } catch {
      // Error is handled silently — conversation stays in list
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, onDeleteConversation]);

  useEffect(() => {
    const unsub = subscribe('conversation_update', (data) => {
      const updated = data as WsConversationUpdate['data'];
      if (deletedIds.has(updated.id)) return;
      onConversationsUpdate((prev) => {
        const exists = prev.find((c) => c.id === updated.id);
        if (exists) {
          return prev.map((c) => (c.id === updated.id ? updated : c));
        }
        return [updated, ...prev];
      });
    });
    return unsub;
  }, [subscribe, onConversationsUpdate]);

  useEffect(() => {
    const unsub = subscribe('typing', (data) => {
      const t = data as WsTyping['data'];
      const key = `${t.conversationId}:${t.participantId}`;
      const name = t.name || 'Someone';

      if (t.active) {
        setTypingMap((prev) => {
          const next = new Map(prev);
          const names = new Set(next.get(t.conversationId) ?? []);
          names.add(name);
          next.set(t.conversationId, names);
          return next;
        });

        const existing = typingTimersRef.current.get(key);
        if (existing) clearTimeout(existing);
        typingTimersRef.current.set(
          key,
          setTimeout(() => {
            setTypingMap((prev) => {
              const next = new Map(prev);
              const names = new Set(next.get(t.conversationId) ?? []);
              names.delete(name);
              if (names.size === 0) next.delete(t.conversationId);
              else next.set(t.conversationId, names);
              return next;
            });
            typingTimersRef.current.delete(key);
          }, 5000)
        );
      } else {
        setTypingMap((prev) => {
          const next = new Map(prev);
          const names = new Set(next.get(t.conversationId) ?? []);
          names.delete(name);
          if (names.size === 0) next.delete(t.conversationId);
          else next.set(t.conversationId, names);
          return next;
        });
        const existing = typingTimersRef.current.get(key);
        if (existing) {
          clearTimeout(existing);
          typingTimersRef.current.delete(key);
        }
      }
    });
    return () => {
      unsub();
      typingTimersRef.current.forEach((timer) => clearTimeout(timer));
      typingTimersRef.current.clear();
    };
  }, [subscribe]);

  // Load archived conversations when tab is switched
  useEffect(() => {
    if (activeTab !== 'archived') return;
    fetchConversations(50, 'archived')
      .then((res) => setArchivedConvs(res.conversations))
      .catch(() => {});
  }, [activeTab]);

  // Load spam/blocked conversations when tab is switched
  useEffect(() => {
    if (activeTab !== 'spam') return;
    fetchConversations(50, 'spam_blocked')
      .then((res) => setSpamConvs(res.conversations))
      .catch(() => {});
  }, [activeTab]);

  // Auto-scroll to selected conversation when it changes (e.g. via command palette)
  useEffect(() => {
    if (!selectedId) return;
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      const el = itemRefs.current.get(selectedId);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [selectedId]);

  // Focus search input when triggered externally (Cmd+S)
  useEffect(() => {
    if (focusSearchTrigger && focusSearchTrigger > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [focusSearchTrigger]);

  // Debounced message content search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (search.length < 2) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    searchTimerRef.current = setTimeout(() => {
      searchMessages(search)
        .then((res) => {
          setSearchResults(res.results);
          setSearchLoading(false);
        })
        .catch(() => {
          setSearchResults([]);
          setSearchLoading(false);
        });
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const sorted = [...conversations].sort((a, b) => {
    const tsA = a.lastMessage?.timestamp ?? 0;
    const tsB = b.lastMessage?.timestamp ?? 0;
    return tsB - tsA;
  });

  // Filter based on active tab
  let filtered: Conversation[];
  if (activeTab === 'archived') {
    filtered = archivedConvs;
  } else if (activeTab === 'spam') {
    filtered = spamConvs;
  } else if (activeTab === 'unread') {
    filtered = sorted.filter((c) => c.unread);
  } else if (activeTab === 'groups') {
    filtered = sorted.filter((c) => c.isGroup);
  } else {
    filtered = sorted;
  }

  // When searching, filter by name
  if (search && !searchResults) {
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  }

  // Status badge
  const getStatusBadge = () => {
    if (!wsConnected) {
      return { label: 'Offline', color: 'text-red-400', bg: 'bg-red-400/12' };
    }
    if (phoneStatus === 'offline') {
      return { label: 'Offline', color: 'text-red-400', bg: 'bg-red-400/12' };
    }
    if (phoneStatus === 'reconnecting') {
      return { label: 'Reconnecting', color: 'text-yellow-400', bg: 'bg-yellow-400/12' };
    }
    return { label: 'Connected', color: 'text-[var(--green)]', bg: 'bg-[var(--green-soft)]' };
  };

  const status = getStatusBadge();

  // Collapsed mode: show only avatars
  if (collapsed) {
    return (
      <div className="w-[68px] min-w-[68px] h-full bg-[var(--surface-1)] rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden transition-all duration-300">
        <div className="titlebar-drag h-12 flex-shrink-0" />
        <div className="flex justify-center px-2 pb-3">
          <button
            onClick={onToggleCollapse}
            className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-all cursor-pointer"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col items-center gap-1">
          {filtered.map((conv) => {
            const isSelected = conv.id === selectedId;
            return (
              <button
                key={conv.id}
                ref={(el) => { if (el) itemRefs.current.set(conv.id, el); else itemRefs.current.delete(conv.id); }}
                onClick={() => onSelect(conv.id)}
                className={`w-11 h-11 rounded-[14px] flex-shrink-0 flex items-center justify-center text-white text-[13px] font-semibold cursor-pointer transition-all relative ${
                  isSelected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface-1)]' : 'hover:opacity-80'
                }`}
                style={{ background: avatarGradient(conv.name) }}
                title={conv.name}
              >
                {getInitials(conv.name)}
                {conv.unread && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[var(--accent)] rounded-full border-2 border-[var(--surface-1)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[340px] min-w-[340px] h-full bg-[var(--surface-1)] rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden transition-all duration-300">
      {/* Draggable title bar spacer for macOS traffic lights */}
      <div className="titlebar-drag h-12 flex-shrink-0" />
      {/* Collapse button below titlebar */}
      <div className="flex justify-end px-4 pb-1">
        <button
          onClick={onToggleCollapse}
          className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-all cursor-pointer"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="w-6 h-6" />
        </button>
      </div>

      <div className="px-5 pb-0">
        {/* Brand header */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-[var(--accent)] to-[#818cf8] flex items-center justify-center">
            <MessageCircle className="w-[18px] h-[18px] text-white" />
          </div>
          <h1 className="text-lg font-semibold">Messages</h1>
          <span className={`ml-auto text-[11px] font-medium ${status.color} ${status.bg} px-2.5 py-0.5 rounded-full`}>
            {status.label}
          </span>
          {onCompose && (
            <button
              onClick={onCompose}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-all cursor-pointer"
              title="New conversation (Cmd+N)"
            >
              <SquarePen className="w-[18px] h-[18px]" />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative titlebar-no-drag mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-3)]" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--surface-2)] text-[var(--text)] text-[13px] pl-10 pr-3 py-2.5 rounded-xl border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none transition-colors placeholder-[var(--text-3)]"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 pb-3">
          {(['all', 'unread', 'groups', 'archived', 'spam'] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-center rounded-[10px] text-xs font-medium transition-all cursor-pointer ${
                activeTab === tab
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-2)] hover:bg-[rgba(255,255,255,0.04)]'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Search results view */}
        {searchResults !== null ? (
          <>
            {searchLoading && (
              <div className="text-center text-[var(--text-3)] text-xs py-3">Searching...</div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <div className="text-center text-[var(--text-3)] text-sm mt-8">No messages found</div>
            )}
            {searchResults.map((result) => {
              const snip = snippet(result.text, search);
              return (
                <button
                  key={`${result.messageId}`}
                  onClick={() => {
                    onSelectMessage(result.conversationId, result.messageId);
                    setSearch('');
                    setSearchResults(null);
                  }}
                  className="w-full flex flex-col gap-0.5 px-3 py-3 text-left transition-colors cursor-pointer hover:bg-[rgba(255,255,255,0.03)] rounded-[14px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[var(--text)] truncate">
                      {result.conversationName}
                    </span>
                    <span className="text-[10px] text-[var(--text-3)] flex-shrink-0 ml-2">
                      {relativeTime(result.timestamp)}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--text-2)]">{result.senderIsMe ? 'You' : result.senderName}</span>
                  <span className="text-xs text-[var(--text-2)] truncate">
                    {snip.before}
                    <span className="text-[var(--accent)] font-medium">{snip.match}</span>
                    {snip.after}
                  </span>
                </button>
              );
            })}
          </>
        ) : (
          <>
            {filtered.map((conv) => {
              const isSelected = conv.id === selectedId;
              return (
                <button
                  key={conv.id}
                  ref={(el) => { if (el) itemRefs.current.set(conv.id, el); else itemRefs.current.delete(conv.id); }}
                  onClick={() => onSelect(conv.id)}
                  onContextMenu={(e) => handleContextMenu(e, conv.id, conv.name)}
                  className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-all cursor-pointer rounded-[14px] mb-0.5 ${
                    isSelected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[rgba(255,255,255,0.03)]'
                  }`}
                >
                  <div
                    className="w-11 h-11 rounded-[14px] flex-shrink-0 flex items-center justify-center text-white text-[15px] font-semibold"
                    style={{ background: avatarGradient(conv.name) }}
                  >
                    {getInitials(conv.name)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[13px] font-medium text-[var(--text)] truncate">
                        {conv.name}
                      </span>
                      {conv.lastMessage && (
                        <span className="text-[10px] text-[var(--text-3)] flex-shrink-0 ml-2">
                          {relativeTime(conv.lastMessage.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      {typingMap.has(conv.id) ? (
                        <span className="text-xs text-[var(--accent)] truncate italic">
                          {[...typingMap.get(conv.id)!].join(', ')} {typingMap.get(conv.id)!.size === 1 ? 'is' : 'are'} typing...
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-2)] truncate">
                          {conv.lastMessage ? truncate(conv.lastMessage.text, 40) : ''}
                        </span>
                      )}
                      {conv.unread && (
                        <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0 ml-2" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center text-[var(--text-3)] text-sm mt-8">
                {search ? 'No conversations found' : activeTab === 'archived' ? 'No archived conversations' : activeTab === 'spam' ? 'No spam or blocked conversations' : 'No conversations yet'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] py-1.5 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              const convId = contextMenu.convId;
              const isArchived = activeTab === 'archived';
              archiveConversation(convId, !isArchived).then(() => {
                if (!isArchived) {
                  onConversationsUpdate((prev) => prev.filter((c) => c.id !== convId));
                } else {
                  setArchivedConvs((prev) => prev.filter((c) => c.id !== convId));
                }
              }).catch(() => {});
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer"
          >
            <Archive className="w-4 h-4" />
            {activeTab === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              muteConversation(contextMenu.convId, true).catch(() => {});
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer"
          >
            <BellOff className="w-4 h-4" />
            Mute
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              blockConversation(contextMenu.convId, true).then(() => {
                onConversationsUpdate((prev) => prev.filter((c) => c.id !== contextMenu.convId));
              }).catch(() => {});
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-orange-400 hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer"
          >
            <Ban className="w-4 h-4" />
            Block
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirm({ convId: contextMenu.convId, convName: contextMenu.convName });
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-red-400 hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Delete conversation
          </button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !deleting && setDeleteConfirm(null)}>
          <div
            className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] p-6 max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { if (!deleting) setDeleteConfirm(null); }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const btns = e.currentTarget.querySelectorAll<HTMLButtonElement>('.confirm-btn:not(:disabled)');
                const idx = Array.from(btns).indexOf(document.activeElement as HTMLButtonElement);
                const next = e.key === 'ArrowRight' ? (idx + 1) % btns.length : (idx - 1 + btns.length) % btns.length;
                btns[next]?.focus();
              }
            }}
          >
            <h3 className="text-[15px] font-semibold text-[var(--text)] mb-2">Delete conversation?</h3>
            <p className="text-[13px] text-[var(--text-2)] mb-5">
              This will permanently delete your conversation with <strong className="text-[var(--text)]">{deleteConfirm.convName}</strong> from this device and your phone.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                autoFocus
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                className="confirm-btn px-4 py-2 text-[13px] font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)] rounded-lg transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1 focus:ring-offset-[var(--surface-1)]"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="confirm-btn px-4 py-2 text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 focus:ring-offset-[var(--surface-1)]"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
