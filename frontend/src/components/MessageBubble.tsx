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
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function StatusIcon({ status }: { status: Message['status'] }) {
  switch (status) {
    case 'sending':
      return <span className="text-gray-400 text-xs">...</span>;
    case 'sent':
      return <Check className="w-3.5 h-3.5 text-gray-400" />;
    case 'delivered':
      return <CheckCheck className="w-3.5 h-3.5 text-gray-400" />;
    case 'read':
      return <CheckCheck className="w-3.5 h-3.5 text-[#4361ee]" />;
    case 'failed':
      return <span className="text-red-500 text-xs">!</span>;
    default:
      return null;
  }
}

export default function MessageBubble({ message, isMe, showSender, onReply, onReact, onImageClick }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [showReactions, setShowReactions] = useState(false);

  // System messages render as centered, muted text — not as chat bubbles
  if (message.isSystemMessage) {
    return (
      <div className="flex items-center justify-center my-2">
        <span className="text-xs text-gray-500 bg-[#1a1a2e] px-3 py-1 rounded-full max-w-sm text-center">
          {message.text}
        </span>
      </div>
    );
  }

  const bubbleBg = isMe ? 'bg-[#4361ee]' : 'bg-[#2a2a3e]';
  const textColor = isMe ? 'text-white' : 'text-[#e2e8f0]';
  const alignment = isMe ? 'items-end' : 'items-start';

  return (
    <div
      className={`flex flex-col ${alignment} mb-1 group relative`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowReactions(false); }}
    >
      {!isMe && showSender && message.sender.name && (
        <span className="text-xs text-gray-400 ml-1 mb-0.5">{message.sender.name}</span>
      )}

      <div className="flex items-end gap-1 relative">
        {isMe && hovered && (
          <div className="flex gap-0.5 mr-1">
            <button
              onClick={() => onReply(message)}
              className="p-1 rounded hover:bg-[#2a2a3e] transition-colors text-gray-400 hover:text-gray-200"
            >
              <MessageSquareReply className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowReactions(true)}
              className="p-1 rounded hover:bg-[#2a2a3e] transition-colors text-gray-400 hover:text-gray-200 relative"
            >
              <SmilePlus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className={`${bubbleBg} ${textColor} rounded-lg px-3 py-2 max-w-md relative`}>
          {message.replyTo && (
            <div className="border-l-2 border-gray-400/50 pl-2 mb-1.5 text-xs opacity-70">
              <span className="font-medium">{message.replyTo.sender}</span>
              <p className="truncate">{message.replyTo.text}</p>
            </div>
          )}

          {message.media.length > 0 && (
            <MediaPlayer media={message.media} messageId={message.id} onImageClick={onImageClick} />
          )}

          {message.text && (
            <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
          )}

          <div className={`flex items-center gap-1 mt-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] opacity-60">{formatTime(message.timestamp)}</span>
            {isMe && <StatusIcon status={message.status} />}
          </div>
        </div>

        {!isMe && hovered && (
          <div className="flex gap-0.5 ml-1">
            <button
              onClick={() => onReply(message)}
              className="p-1 rounded hover:bg-[#2a2a3e] transition-colors text-gray-400 hover:text-gray-200"
            >
              <MessageSquareReply className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowReactions(true)}
              className="p-1 rounded hover:bg-[#2a2a3e] transition-colors text-gray-400 hover:text-gray-200 relative"
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

      {message.reactions.length > 0 && (
        <div className="flex gap-1 mt-0.5 ml-1">
          {message.reactions.map((r) => (
            <span
              key={r.emoji}
              className="bg-[#2a2a3e] rounded-full px-1.5 py-0.5 text-xs border border-[#3a3a4e]"
            >
              {r.emoji} {r.senderIds.length > 1 ? r.senderIds.length : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
