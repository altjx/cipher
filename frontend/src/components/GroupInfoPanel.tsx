import { useState, useEffect } from 'react';
import { X, Users } from 'lucide-react';
import type { Conversation } from '../api/client';
import { getConversationDetails } from '../api/client';
import { avatarGradient } from '../utils/avatarGradient';

interface GroupInfoPanelProps {
  conversationId: string;
  conversation: Conversation | undefined;
  onClose: () => void;
}

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

export default function GroupInfoPanel({ conversationId, conversation, onClose }: GroupInfoPanelProps) {
  const [details, setDetails] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getConversationDetails(conversationId)
      .then((data) => {
        setDetails(data);
        setLoading(false);
      })
      .catch(() => {
        // Fall back to the conversation prop
        if (conversation) setDetails(conversation);
        setLoading(false);
      });
  }, [conversationId, conversation]);

  const display = details ?? conversation;
  const participants = display?.participants ?? [];
  const others = participants.filter((p) => !p.isMe);
  const me = participants.find((p) => p.isMe);

  return (
    <div className="w-[300px] min-w-[300px] h-full bg-[var(--surface-1)] rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="titlebar-drag h-12 flex-shrink-0" />
      <div className="px-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-[var(--text-2)]" />
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Group Info</h2>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--text-3)] text-sm">Loading...</div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* Group name & avatar */}
          {display && (
            <div className="flex flex-col items-center mb-6">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-semibold mb-3"
                style={{ background: avatarGradient(display.name) }}
              >
                {getInitials(display.name)}
              </div>
              <h3 className="text-base font-semibold text-[var(--text)] text-center">{display.name}</h3>
              <p className="text-xs text-[var(--text-3)] mt-1">{participants.length} participants</p>
            </div>
          )}

          {/* Participants */}
          <div className="mb-4">
            <h4 className="text-xs font-medium text-[var(--text-3)] uppercase tracking-wider mb-3">Participants</h4>
            <div className="space-y-1">
              {me && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                  <div
                    className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-[12px] font-semibold"
                    style={{ background: avatarGradient(me.avatarColor ?? '#3b82f6') }}
                  >
                    {getInitials(me.name || 'You')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--text)] truncate">You</p>
                    {me.number && <p className="text-[11px] text-[var(--text-3)]">{me.number}</p>}
                  </div>
                </div>
              )}
              {others.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-2)] transition-colors">
                  <div
                    className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-[12px] font-semibold"
                    style={{ background: avatarGradient(p.avatarColor ?? '#3b82f6') }}
                  >
                    {getInitials(p.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--text)] truncate">{p.name}</p>
                    {p.number && <p className="text-[11px] text-[var(--text-3)]">{p.number}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
