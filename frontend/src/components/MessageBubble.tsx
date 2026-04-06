import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { MessageSquareReply, SmilePlus, Check, CheckCheck, Trash2, RotateCcw, Copy, ExternalLink } from 'lucide-react';
import type { Message } from '../api/client';
import MediaPlayer from './MediaPlayer';
import EmojiPicker from './EmojiPicker';
import LinkPreview from './LinkPreview';
import Avatar from './Avatar';

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  showSender: boolean;
  onReply: (message: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
  onRemoveReaction?: (messageId: string, emoji: string) => void;
  myParticipantId?: string;
  onDelete?: (messageId: string) => void;
  onResend?: (message: Message) => void;
  onImageClick?: (url: string) => void;
  onImageLoad?: () => void;
  conversationName?: string;
  showTimestamp?: boolean;
  isGroup?: boolean;
  senderColor?: string;
  isLastRead?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const URL_RE = /(https?:\/\/[^\s<]+)/g;

function linkifyText(text: string): (string | React.ReactNode)[] {
  const parts: (string | React.ReactNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{url}</a>
    );
    lastIndex = URL_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

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
      return <span className="text-red-500 text-xs font-medium">Failed</span>;
    default:
      return null;
  }
}

export default function MessageBubble({ message, isMe, showSender, onReply, onReact, onRemoveReaction, myParticipantId, onDelete, onResend, onImageClick, onImageLoad, conversationName, showTimestamp, isGroup, senderColor: sColor, isLastRead }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [linkMenu, setLinkMenu] = useState<{ x: number; y: number; url: string } | null>(null);
  const [copyToast, setCopyToast] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef<{ el: HTMLElement; top: number } | null>(null);

  // Close link context menu on click outside
  useEffect(() => {
    if (!linkMenu) return;
    const handleClick = () => setLinkMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [linkMenu]);

  // Restore scroll position after the emoji picker renders and steals focus
  useLayoutEffect(() => {
    if (showReactions && savedScrollRef.current) {
      const { el, top } = savedScrollRef.current;
      // Restore immediately (catches synchronous layout shifts)
      el.scrollTop = top;
      // Also restore after a frame (catches async focus-driven scrolling from the picker)
      requestAnimationFrame(() => { el.scrollTop = top; });
      savedScrollRef.current = null;
    }
  }, [showReactions]);

  const openReactionPicker = () => {
    // Find the scrollable ancestor and save its scroll position
    let el = rootRef.current?.parentElement;
    while (el) {
      if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible') {
        savedScrollRef.current = { el, top: el.scrollTop };
        break;
      }
      el = el.parentElement;
    }
    setShowReactions(true);
  };

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
  const showGroupStyle = isGroup && !isMe && !!sColor;

  return (
    <div
      ref={rootRef}
      className={`flex flex-col ${alignment} mb-1 group relative`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!showReactions) { setHovered(false); } }}
    >
      {!isMe && showSender && message.sender.name && !showGroupStyle && (
        <span className="text-xs text-[var(--text-2)] ml-1 mb-0.5">{message.sender.name}</span>
      )}

      <div className="flex items-end gap-2 relative max-w-[50%]">
        {/* Group chat avatar */}
        {showGroupStyle && showSender && (
          <div className="mb-0.5">
            <Avatar name={message.sender.name} participantId={message.sender.id} size={28} rounded="9999px" gradientKey={sColor} />
          </div>
        )}
        {showGroupStyle && !showSender && (
          <div className="w-7 flex-shrink-0" />
        )}

        {isMe && hovered && (
          <div className="absolute right-full bottom-0 flex gap-0.5 mr-1">
            {message.status === 'failed' && onResend && (
              <button
                onClick={() => onResend(message)}
                className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-orange-400 hover:text-orange-300"
                title="Retry sending"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => onReply(message)}
              className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)]"
            >
              <MessageSquareReply className="w-3.5 h-3.5" />
            </button>
            <div className="relative">
              <button
                onClick={() => openReactionPicker()}
                className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)]"
              >
                <SmilePlus className="w-3.5 h-3.5" />
              </button>
              {showReactions && (
                <div className="absolute bottom-full right-0 mb-2 z-50">
                  <EmojiPicker
                    onSelect={(emoji) => {
                      onReact(message.id, emoji);
                      setShowReactions(false);
                    }}
                    onClose={() => setShowReactions(false)}
                  />
                </div>
              )}
            </div>
            {onDelete && (
              <button
                onClick={() => onDelete(message.id)}
                className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-red-400"
                title="Delete message"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <div
          className={`${
            isMe
              ? 'bg-[var(--accent-2)] text-white rounded-[18px_18px_6px_18px] shadow-[0_2px_8px_rgba(59,130,246,0.2)]'
              : showGroupStyle
                ? 'bg-[var(--surface-2)] text-[var(--text)] rounded-[4px_18px_18px_4px] border-l-[3px]'
                : 'bg-[var(--surface-2)] text-[var(--text)] rounded-[18px_18px_18px_6px]'
          } px-4 py-2.5 relative overflow-hidden ${message.reactions.length > 0 ? 'mb-3' : ''}`}
          style={showGroupStyle ? { borderLeftColor: sColor } : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            const target = e.target as HTMLElement;
            const anchor = target.closest('a');
            if (anchor) {
              const url = anchor.getAttribute('href');
              if (url) {
                setLinkMenu({ x: e.clientX, y: e.clientY, url });
                return;
              }
            }
            setHovered(true);
            openReactionPicker();
          }}
        >
          {/* Colored sender name inside bubble for group chats */}
          {showGroupStyle && showSender && message.sender.name && (
            <span className="text-[11px] font-semibold block mb-1" style={{ color: sColor }}>{message.sender.name}</span>
          )}

          {message.replyTo && (
            <div className="border-l-2 border-white/30 pl-2 mb-1.5 text-xs opacity-70">
              <span className="font-medium">{message.replyTo.sender}</span>
              <p className="truncate">{message.replyTo.text}</p>
            </div>
          )}

          {message.media.length > 0 && (
            <MediaPlayer media={message.media} messageId={message.id} isMe={isMe} onImageClick={onImageClick} onImageLoad={onImageLoad} />
          )}

          {message.text && (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed" style={{ overflowWrap: 'anywhere' }}>{linkifyText(message.text)}</p>
          )}

          {message.text && URL_RE.test(message.text) && (
            <LinkPreview text={message.text} isMe={isMe} />
          )}

          <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'} ${showTimestamp ? '' : 'hidden'}`}>
            <span className={`text-[10px] ${isMe ? 'text-white/45' : 'text-[var(--text-3)]'}`}>{formatTime(message.timestamp)}</span>
            {isMe && <StatusIcon status={message.status} />}
          </div>

          {message.reactions.length > 0 && (
            <div className={`absolute -bottom-3 ${isMe ? 'left-2' : 'right-2'} flex gap-0.5`}>
              {message.reactions.map((r) => {
                const isMine = myParticipantId ? r.senderIds.includes(myParticipantId) : false;
                return (
                  <button
                    key={r.emoji}
                    onClick={isMine && onRemoveReaction ? () => onRemoveReaction(message.id, r.emoji) : undefined}
                    className={`bg-[var(--surface-3)] rounded-full px-1.5 py-0.5 text-xs border shadow-sm transition-colors ${
                      isMine
                        ? 'border-[var(--accent)]/50 hover:bg-[var(--surface-2)] cursor-pointer'
                        : 'border-[var(--border)] cursor-default'
                    }`}
                  >
                    {r.emoji}{r.senderIds.length > 1 ? ` ${r.senderIds.length}` : ''}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!isMe && hovered && (
          <div className="absolute left-full bottom-0 flex gap-0.5 ml-1">
            <button
              onClick={() => onReply(message)}
              className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)]"
            >
              <MessageSquareReply className="w-3.5 h-3.5" />
            </button>
            <div className="relative">
              <button
                onClick={() => openReactionPicker()}
                className="p-1 rounded hover:bg-[var(--surface-3)] transition-colors text-[var(--text-3)] hover:text-[var(--text)]"
              >
                <SmilePlus className="w-3.5 h-3.5" />
              </button>
              {showReactions && (
                <div className="absolute bottom-full left-0 mb-2 z-50">
                  <EmojiPicker
                    onSelect={(emoji) => {
                      onReact(message.id, emoji);
                      setShowReactions(false);
                    }}
                    onClose={() => setShowReactions(false)}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Read receipt row — only shown on the last read message */}
      {isMe && isLastRead && conversationName && (
        <div className="flex gap-1 items-center px-1 mt-0.5">
          <div className="w-3.5 h-3.5 rounded-full bg-[var(--surface-3)] text-[7px] text-[var(--text-2)] flex items-center justify-center font-semibold">
            {getInitials(conversationName).charAt(0)}
          </div>
          <span className="text-[10px] text-[var(--text-3)]">Read {formatTime(message.timestamp)}</span>
        </div>
      )}

      {/* Link context menu */}
      {linkMenu && (
        <div
          className="fixed z-50 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] py-1.5 min-w-[160px]"
          style={{ left: linkMenu.x, top: linkMenu.y }}
        >
          <button
            onClick={() => {
              const pos = { x: linkMenu.x, y: linkMenu.y };
              navigator.clipboard.writeText(linkMenu.url);
              setLinkMenu(null);
              setCopyToast(pos);
              setTimeout(() => setCopyToast(null), 1500);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer"
          >
            <Copy className="w-4 h-4" />
            Copy Link
          </button>
          <button
            onClick={() => {
              if (window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(linkMenu.url);
              } else {
                window.open(linkMenu.url, '_blank', 'noopener,noreferrer');
              }
              setLinkMenu(null);
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)] transition-colors cursor-pointer"
          >
            <ExternalLink className="w-4 h-4" />
            Open Link
          </button>
        </div>
      )}

      {/* Copy confirmation toast */}
      {copyToast && (
        <div
          className="fixed z-50 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.3)] px-3 py-1.5 text-[13px] text-[var(--text)] flex items-center gap-2 animate-[fadeInOut_1.5s_ease-in-out]"
          style={{ left: copyToast.x, top: copyToast.y }}
        >
          <Check className="w-3.5 h-3.5 text-green-400" />
          Copied!
        </div>
      )}
    </div>
  );
}
