import { useState, useEffect, useCallback } from 'react';
import type { Conversation, WsPhoneStatus } from './api/client';
import { getStatus, fetchConversations } from './api/client';
import { useWebSocket } from './hooks/useWebSocket';
import QRPairing from './components/QRPairing';
import ConversationList from './components/ConversationList';
import MessageThread from './components/MessageThread';
import DetailPanel from './components/DetailPanel';

type AppView = 'loading' | 'pairing' | 'main';

export default function App() {
  const [view, setView] = useState<AppView>('loading');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [phoneStatus, setPhoneStatus] = useState<'connected' | 'offline' | 'reconnecting' | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailParticipantId, setDetailParticipantId] = useState<string | null>(null);

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

    return () => {
      unsubExpired();
      unsubPhone();
    };
  }, [subscribe]);

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

  const handleShowParticipantDetail = useCallback((participantId: string) => {
    setDetailParticipantId(participantId);
    setDetailOpen(true);
  }, []);

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
        subscribe={subscribe}
        phoneStatus={phoneStatus}
        wsConnected={connectionState === 'connected'}
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
    </div>
  );
}
