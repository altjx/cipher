import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import type { Conversation, WsConversationUpdate, WsTyping, SearchResult } from '../api/client';
import { searchMessages } from '../api/client';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectMessage: (conversationId: string, messageId: string) => void;
  onConversationsUpdate: (updater: (prev: Conversation[]) => Conversation[]) => void;
  subscribe: (eventType: 'conversation_update' | 'typing', callback: (data: unknown) => void) => () => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
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
  subscribe,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // Map of conversationId -> set of typing names
  const [typingMap, setTypingMap] = useState<Map<string, Set<string>>>(new Map());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const unsub = subscribe('conversation_update', (data) => {
      const updated = data as WsConversationUpdate['data'];
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

  // When not searching content, still filter conversations by name
  const filtered = search && !searchResults
    ? sorted.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  return (
    <div className="w-80 min-w-[320px] h-full bg-[#1a1a2e] border-r border-[#2a2a3e] flex flex-col">
      {/* Draggable title bar spacer for macOS traffic lights */}
      <div className="titlebar-drag h-12 flex-shrink-0" />
      <div className="px-3 pb-3 border-b border-[#2a2a3e]">
        <div className="relative titlebar-no-drag">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search messages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0f0f1a] text-[#e2e8f0] text-sm pl-9 pr-3 py-2 rounded-lg border border-[#2a2a3e] focus:border-[#4361ee] focus:outline-none transition-colors placeholder-gray-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Search results view */}
        {searchResults !== null ? (
          <>
            {searchLoading && (
              <div className="text-center text-gray-500 text-xs py-3">Searching...</div>
            )}
            {!searchLoading && searchResults.length === 0 && (
              <div className="text-center text-gray-500 text-sm mt-8">No messages found</div>
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
                  className="w-full flex flex-col gap-0.5 px-4 py-3 text-left transition-colors cursor-pointer hover:bg-[#2a2a3e]/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[#e2e8f0] truncate">
                      {result.conversationName}
                    </span>
                    <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                      {relativeTime(result.timestamp)}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">{result.senderIsMe ? 'You' : result.senderName}</span>
                  <span className="text-xs text-gray-400 truncate">
                    {snip.before}
                    <span className="text-[#4361ee] font-medium">{snip.match}</span>
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
              const avatarColor = conv.participants[0]?.avatarColor ?? '#4361ee';

              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                    isSelected ? 'bg-[#4361ee]/15' : 'hover:bg-[#2a2a3e]/50'
                  }`}
                >
                  <div
                    className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-medium"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {getInitials(conv.name)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-[#e2e8f0] truncate">
                        {conv.name}
                      </span>
                      {conv.lastMessage && (
                        <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                          {relativeTime(conv.lastMessage.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      {typingMap.has(conv.id) ? (
                        <span className="text-xs text-[#4361ee] truncate italic">
                          {[...typingMap.get(conv.id)!].join(', ')} {typingMap.get(conv.id)!.size === 1 ? 'is' : 'are'} typing...
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 truncate">
                          {conv.lastMessage ? truncate(conv.lastMessage.text, 40) : ''}
                        </span>
                      )}
                      {conv.unread && (
                        <span className="w-2.5 h-2.5 bg-[#4361ee] rounded-full flex-shrink-0 ml-2" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center text-gray-500 text-sm mt-8">
                {search ? 'No conversations found' : 'No conversations yet'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
