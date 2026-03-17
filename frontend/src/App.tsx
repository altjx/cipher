import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Conversation, WsPhoneStatus, WsConversationDeleted } from './api/client';
import { getStatus, fetchConversations, deleteConversation } from './api/client';
import { useWebSocket } from './hooks/useWebSocket';
import QRPairing from './components/QRPairing';
import ConversationList from './components/ConversationList';
import MessageThread from './components/MessageThread';
import DetailPanel from './components/DetailPanel';
import CommandPalette from './components/CommandPalette';
import ComposeDialog from './components/ComposeDialog';
import SettingsPanel from './components/SettingsPanel';

type AppView = 'loading' | 'pairing' | 'main';

export default function App() {
  const [view, setView] = useState<AppView>('loading');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [phoneStatus, setPhoneStatus] = useState<'connected' | 'offline' | 'reconnecting' | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailParticipantId, setDetailParticipantId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteInitialMode, setPaletteInitialMode] = useState<'commands' | 'goto' | 'themes'>('commands');
  const [deleteConfirm, setDeleteConfirm] = useState<{ convId: string; convName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refocusTrigger, setRefocusTrigger] = useState(0);
  const [searchTrigger, setSearchTrigger] = useState(0);        // Cmd+F: find in conversation
  const [globalSearchTrigger, setGlobalSearchTrigger] = useState(0); // Cmd+S: search all
  const [composeOpen, setComposeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [emojiInsert, setEmojiInsert] = useState<{ emoji: string; seq: number }>({ emoji: '', seq: 0 });
  const [reactionEmoji, setReactionEmoji] = useState<{ emoji: string; seq: number }>({ emoji: '', seq: 0 });
  const reactChordArmed = useRef(false);
  const reactChordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deletedIdsRef = useRef<Set<string>>(new Set());
  const { subscribe, connectionState } = useWebSocket();

  // Check status on mount
  useEffect(() => {
    getStatus()
      .then((res) => {
        if (res.status === 'paired' || res.status === 'phone_offline') {
          setView('main');
          if (res.status === 'phone_offline') {
            setPhoneStatus('offline');
          }
        } else {
          setView('pairing');
        }
      })
      .catch(() => {
        setView('pairing');
      });
  }, []);

  // Load conversations when entering main view
  useEffect(() => {
    if (view !== 'main') return;

    fetchConversations(50)
      .then((res) => {
        setConversations(res.conversations);
      })
      .catch(() => {});
  }, [view]);

  const handleDeleteConversation = useCallback((id: string) => {
    deletedIdsRef.current.add(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setSelectedConversationId((prev) => (prev === id ? null : prev));
  }, []);

  // Subscribe to session and phone events
  useEffect(() => {
    const unsubExpired = subscribe('session_expired', () => {
      setView('pairing');
      setConversations([]);
      setSelectedConversationId(null);
    });

    const unsubPhone = subscribe('phone_status', (data) => {
      const d = data as WsPhoneStatus['data'];
      setPhoneStatus(d.status);
    });

    const unsubDeleted = subscribe('conversation_deleted', (data) => {
      const d = data as WsConversationDeleted['data'];
      handleDeleteConversation(d.conversationId);
    });

    return () => {
      unsubExpired();
      unsubPhone();
      unsubDeleted();
    };
  }, [subscribe, handleDeleteConversation]);

  const handlePaired = useCallback(() => {
    setView('main');
  }, []);

  const handleConversationsUpdate = useCallback(
    (updater: (prev: Conversation[]) => Conversation[]) => {
      setConversations(updater);
    },
    []
  );

  const handleSelectMessage = useCallback((conversationId: string, messageId: string) => {
    setSelectedConversationId(conversationId);
    setTargetMessageId(messageId);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setSelectedConversationId(id);
    setDetailOpen(false);
    setDetailParticipantId(null);
  }, []);

  const toggleDetail = useCallback(() => {
    setDetailOpen((v) => !v);
    setDetailParticipantId(null);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);

  const handleShowParticipantDetail = useCallback((participantId: string) => {
    setDetailParticipantId(participantId);
    setDetailOpen(true);
  }, []);

  // Sorted conversation list for navigation
  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0)),
    [conversations]
  );

  // Navigate to prev/next conversation, prioritizing unread
  const navigateConversation = useCallback((direction: 'prev' | 'next') => {
    if (sortedConversations.length === 0) return;

    const currentIdx = selectedConversationId
      ? sortedConversations.findIndex((c) => c.id === selectedConversationId)
      : -1;

    // Try to find next unread in the given direction
    const unreadInDirection = direction === 'prev'
      ? sortedConversations.filter((_, i) => i < currentIdx && sortedConversations[i].unread)
      : sortedConversations.filter((_, i) => i > currentIdx && sortedConversations[i].unread);

    if (unreadInDirection.length > 0) {
      const target = direction === 'prev'
        ? unreadInDirection[unreadInDirection.length - 1] // closest unread before
        : unreadInDirection[0]; // closest unread after
      handleSelectConversation(target.id);
      return;
    }

    // Fall back to adjacent conversation
    const nextIdx = direction === 'prev'
      ? Math.max(0, currentIdx - 1)
      : Math.min(sortedConversations.length - 1, currentIdx + 1);

    if (nextIdx !== currentIdx && sortedConversations[nextIdx]) {
      handleSelectConversation(sortedConversations[nextIdx].id);
    }
  }, [sortedConversations, selectedConversationId, handleSelectConversation]);

  // Emoji shortcut mapping: Cmd+# inserts, Cmd+Opt+# reacts
  const EMOJI_SHORTCUTS: Record<string, string> = {
    '1': '\u{1F4AF}', // 💯
    '2': '\u2764\uFE0F', // ❤️
    '3': '\u{1F602}', // 😂
    '4': '\u{1F44D}', // 👍
    '5': '\u{1F62E}', // 😮
    '6': '\u{1F622}', // 😢
    '7': '\u{1F64F}', // 🙏
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (view !== 'main') return;

      // Second step of react chord: bare 1-7 after Cmd+E
      if (reactChordArmed.current && EMOJI_SHORTCUTS[e.key] && selectedConversationId) {
        e.preventDefault();
        reactChordArmed.current = false;
        if (reactChordTimer.current) { clearTimeout(reactChordTimer.current); reactChordTimer.current = null; }
        setReactionEmoji((prev) => ({ emoji: EMOJI_SHORTCUTS[e.key], seq: prev.seq + 1 }));
        return;
      }
      // Cancel chord on any other key
      if (reactChordArmed.current) {
        reactChordArmed.current = false;
        if (reactChordTimer.current) { clearTimeout(reactChordTimer.current); reactChordTimer.current = null; }
      }

      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta) return;

      // Cmd+1-7: insert emoji into input
      const emoji = EMOJI_SHORTCUTS[e.key];
      if (emoji && selectedConversationId) {
        e.preventDefault();
        setEmojiInsert((prev) => ({ emoji, seq: prev.seq + 1 }));
        return;
      }

      // Cmd+X: arm react chord (then press 1-7)
      if (e.key === 'x' && selectedConversationId) {
        e.preventDefault();
        reactChordArmed.current = true;
        if (reactChordTimer.current) clearTimeout(reactChordTimer.current);
        reactChordTimer.current = setTimeout(() => { reactChordArmed.current = false; reactChordTimer.current = null; }, 2000);
        return;
      }

      switch (e.key) {
        case 'n': // Cmd+N: New conversation
          e.preventDefault();
          setComposeOpen(true);
          break;
        case ',': // Cmd+,: Settings
          e.preventDefault();
          setSettingsOpen(true);
          break;
        case 't': // Cmd+T: Change theme
          e.preventDefault();
          setPaletteInitialMode('themes');
          setPaletteOpen(true);
          break;
        case 'k': // Cmd+K: Command palette
          e.preventDefault();
          setPaletteInitialMode('commands');
          setPaletteOpen((v) => !v);
          break;
        case 'g': // Cmd+G: Go to conversation
          e.preventDefault();
          setPaletteInitialMode('goto');
          setPaletteOpen(true);
          break;
        case '[': // Cmd+[: Previous conversation
          e.preventDefault();
          navigateConversation('prev');
          break;
        case ']': // Cmd+]: Next conversation
          e.preventDefault();
          navigateConversation('next');
          break;
        case 'l': // Cmd+L: Toggle sidebar
          e.preventDefault();
          setSidebarCollapsed((v) => !v);
          break;
        case 'i': // Cmd+I: Toggle info panel
          e.preventDefault();
          if (selectedConversationId) {
            setDetailOpen((v) => !v);
            setDetailParticipantId(null);
          }
          break;
        case 'f': // Cmd+F: Find in conversation
          e.preventDefault();
          if (selectedConversationId) {
            setSearchTrigger((v) => v + 1);
          }
          break;
        case 's': // Cmd+S: Search all conversations
          e.preventDefault();
          setSidebarCollapsed(false);
          setGlobalSearchTrigger((v) => v + 1);
          break;
        case 'd': // Cmd+D: Delete conversation
          e.preventDefault();
          if (selectedConversationId) {
            const conv = conversations.find((c) => c.id === selectedConversationId);
            setDeleteConfirm({ convId: selectedConversationId, convName: conv?.name ?? 'this conversation' });
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, navigateConversation, selectedConversationId, conversations]);

  // Handle actions dispatched from the command palette
  const handlePaletteAction = useCallback((action: string) => {
    switch (action) {
      case 'prev':
        navigateConversation('prev');
        break;
      case 'next':
        navigateConversation('next');
        break;
      case 'find-in-conversation':
        if (selectedConversationId) setSearchTrigger((v) => v + 1);
        break;
      case 'search-all':
        setSidebarCollapsed(false);
        setGlobalSearchTrigger((v) => v + 1);
        break;
      case 'toggle-sidebar':
        setSidebarCollapsed((v) => !v);
        break;
      case 'toggle-info':
        if (selectedConversationId) {
          setDetailOpen((v) => !v);
          setDetailParticipantId(null);
        }
        break;
      case 'open-settings':
        setSettingsOpen(true);
        break;
    }
    setRefocusTrigger((v) => v + 1);
  }, [navigateConversation, selectedConversationId]);

  const handleConversationCreated = useCallback((conversationId: string) => {
    setComposeOpen(false);
    setSelectedConversationId(conversationId);
    // Refresh conversations to include the new one
    fetchConversations(50)
      .then((res) => setConversations(res.conversations))
      .catch(() => {});
  }, []);

  const handleDeleteConfirmAction = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await deleteConversation(deleteConfirm.convId);
      handleDeleteConversation(deleteConfirm.convId);
    } catch {
      // Error handled silently
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, handleDeleteConversation]);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--bg)]">
        <div className="text-[var(--text-2)] text-lg">Connecting...</div>
      </div>
    );
  }

  if (view === 'pairing') {
    return <QRPairing subscribe={subscribe} onPaired={handlePaired} />;
  }

  return (
    <div className="flex h-screen p-3 gap-3 bg-[var(--bg)]">
      <ConversationList
        conversations={conversations}
        selectedId={selectedConversationId}
        onSelect={handleSelectConversation}
        onSelectMessage={handleSelectMessage}
        onConversationsUpdate={handleConversationsUpdate}
        onDeleteConversation={handleDeleteConversation}
        deletedIds={deletedIdsRef.current}
        subscribe={subscribe}
        phoneStatus={phoneStatus}
        wsConnected={connectionState === 'connected'}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        focusSearchTrigger={globalSearchTrigger}
        onCompose={() => setComposeOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      {selectedConversationId ? (
        <MessageThread
          conversationId={selectedConversationId}
          conversation={selectedConversation}
          subscribe={subscribe}
          targetMessageId={targetMessageId}
          onTargetReached={() => setTargetMessageId(null)}
          detailOpen={detailOpen}
          onToggleDetail={toggleDetail}
          onShowParticipantDetail={handleShowParticipantDetail}
          searchTrigger={searchTrigger}
          refocusTrigger={refocusTrigger}
          emojiInsert={emojiInsert}
          reactionEmoji={reactionEmoji}
        />
      ) : (
        <div className="flex-1 bg-[var(--surface-1)] rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] flex flex-col">
          <div className="titlebar-drag h-12 flex-shrink-0" />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-[var(--text-3)]">
              <p className="text-lg mb-1">Select a conversation</p>
              <p className="text-sm">Choose from the list on the left to start messaging</p>
            </div>
          </div>
        </div>
      )}

      {detailOpen && selectedConversation && (
        <DetailPanel
          conversationId={selectedConversationId!}
          conversation={selectedConversation}
          focusParticipantId={detailParticipantId}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          conversations={sortedConversations}
          hasConversation={!!selectedConversationId}
          initialMode={paletteInitialMode}
          onAction={handlePaletteAction}
          onSelectConversation={handleSelectConversation}
          onClose={() => { setPaletteOpen(false); setPaletteInitialMode('commands'); setRefocusTrigger((v) => v + 1); }}
        />
      )}

      {composeOpen && (
        <ComposeDialog
          onConversationCreated={handleConversationCreated}
          onClose={() => setComposeOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      )}

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
                onClick={handleDeleteConfirmAction}
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
