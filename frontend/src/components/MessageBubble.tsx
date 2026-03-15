import { useState } from 'react';
import { MessageSquareReply, SmilePlus, Check, CheckCheck } from 'lucide-react';
import type { Message } from '../api/client';
import MediaPlayer from './MediaPlayer';
import ReactionPicker from './ReactionPicker';

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  showSender: boolean;
  onReply: (message: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
  onImageClick?: (url: string) => void;
  conversationName?: string;
  showTimestamp?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
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

function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <span className="text-[var(--text-3)] text-xs">...</span>;
    case 'sent':
      return <Check className="w-3.5 h-3.5 text-[var(--text-3)]" />;
    case 'delivered':
      return <CheckCheck className="w-3.5 h-3.5 text-[var(--text-3)]" />;
    case 'read':
      return <CheckCheck className="w-3.5 h-3.5 text-[var(--accent)]" />;
    case 'failed':
      return <span className="text-red-500 text-xs">!</span>;
    default:
      return null;
  }
}

export default function MessageBubble({ message, isMe, showSender, onReply, onReact, onImageClick, conversationName, showTimestamp }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [showReactions, setShowReactions] = useState(false);

  // System messages render as centered, muted text — not as chat bubbles
  if (message.isSystemMessage) {
    return (
      <div className="flex items-center justify-center my-2">
        <span className="text-xs text-[var(--text-3)] bg-[var(--surface-2)] px-3 py-1 rounded-full max-w-sm text-center">
          {message.text}
        </span>
      </div>
    );
  }

  const alignment = isMe ? 'items-end' : 'items-start';

  return (
    <div
      className={`flex flex-col ${alignment} mb-1 group relative`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowReactions(false); }}
    >
      {!isMe && showSender && message.sender.name && (
        <span className="text-xs text-[var(--text-2)] ml-1 mb-0.5">{message.sender.name}</span>
      )}

      <div className="flex items-end gap-1 relative">
        {isMe && hovered && (
          <div className="flex gap-0.5 mr-1">
            <button
              onClick={() => onReply(message)}
              className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)]"
            >
              <MessageSquareReply className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowReactions(true)}
              className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)] relative"
            >
              <SmilePlus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className={`${
          isMe
            ? 'bg-[var(--accent-2)] text-white rounded-[18px_18px_6px_18px] shadow-[0_2px_8px_rgba(59,130,246,0.2)]'
            : 'bg-[var(--surface-2)] text-[var(--text)] rounded-[18px_18px_18px_6px]'
        } px-4 py-2.5 max-w-md relative ${message.reactions.length > 0 ? 'mb-3' : ''}`}>
          {message.replyTo && (
            <div className="border-l-2 border-white/30 pl-2 mb-1.5 text-xs opacity-70">
              <span className="font-medium">{message.replyTo.sender}</span>
              <p className="truncate">{message.replyTo.text}</p>
            </div>
          )}

          {message.media.length > 0 && (
            <MediaPlayer media={message.media} messageId={message.id} isMe={isMe} onImageClick={onImageClick} />
          )}

          {message.text && (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
          )}

          <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'} ${showTimestamp ? '' : 'hidden'}`}>
            <span className={`text-[10px] ${isMe ? 'text-white/45' : 'text-[var(--text-3)]'}`}>{formatTime(message.timestamp)}</span>
            {isMe && <StatusIcon status={message.status} />}
          </div>

          {message.reactions.length > 0 && (
            <div className={`absolute -bottom-3 ${isMe ? 'left-2' : 'right-2'} flex gap-0.5`}>
              {message.reactions.map((r) => (
                <span
                  key={r.emoji}
                  className="bg-[var(--surface-3)] rounded-full px-1.5 py-0.5 text-xs border border-[var(--border)] shadow-sm"
                >
                  {r.emoji}{r.senderIds.length > 1 ? ` ${r.senderIds.length}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>

        {!isMe && hovered && (
          <div className="flex gap-0.5 ml-1">
            <button
              onClick={() => onReply(message)}
              className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)]"
            >
              <MessageSquareReply className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowReactions(true)}
              className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)] relative"
            >
              <SmilePlus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {showReactions && (
          <div className={`absolute ${isMe ? 'right-0' : 'left-0'} bottom-full`}>
            <ReactionPicker
              onSelect={(emoji) => {
                onReact(message.id, emoji);
                setShowReactions(false);
              }}
              onClose={() => setShowReactions(false)}
            />
          </div>
        )}
      </div>

      {/* Read receipt row */}
      {isMe && message.status === 'read' && conversationName && (
        <div className="flex gap-1 items-center px-1 mt-0.5">
          <div className="w-3.5 h-3.5 rounded-full bg-[var(--surface-3)] text-[7px] text-[var(--text-2)] flex items-center justify-center font-semibold">
            {getInitials(conversationName).charAt(0)}
          </div>
          <span className="text-[10px] text-[var(--text-3)]">Read {formatTime(message.timestamp)}</span>
        </div>
      )}

    </div>
  );
}
