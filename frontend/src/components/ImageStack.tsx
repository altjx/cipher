import { useState } from 'react';
import type { Message } from '../api/client';
import { getMediaUrl } from './MediaPlayer';
import Avatar from './Avatar';

interface ImageStackProps {
  messages: Message[];
  isMe: boolean;
  showSender: boolean;
  onImageClick: (url: string) => void;
  onImageLoad?: () => void;
  isGroup?: boolean;
  senderColor?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function ImageStack({ messages, isMe, showSender, onImageClick, onImageLoad, isGroup, senderColor }: ImageStackProps) {
  const [hovered, setHovered] = useState(false);
  const alignment = isMe ? 'items-end' : 'items-start';
  const showGroupStyle = isGroup && !isMe && !!senderColor;

  const imageUrls = messages.map((msg) => {
    const imgMedia = msg.media.find((m) => m.mimeType.startsWith('image/'));
    return imgMedia ? getMediaUrl(imgMedia, msg.id) : '';
  }).filter(Boolean);

  const count = imageUrls.length;
  const frontUrl = imageUrls[0];
  const firstMsg = messages[0];
  const lastMsg = messages[messages.length - 1];

  // Cards shown behind: up to 2 back cards from the stack
  const backCards = imageUrls.slice(1, 3);

  return (
    <div className={`flex flex-col ${alignment} mb-1`}>
      {!isMe && showSender && firstMsg.sender.name && !showGroupStyle && (
        <span className="text-xs text-[var(--text-2)] ml-1 mb-0.5">{firstMsg.sender.name}</span>
      )}

      <div className="flex items-end gap-2">
        {/* Group chat avatar */}
        {showGroupStyle && showSender && (
          <div className="mb-0.5">
            <Avatar name={firstMsg.sender.name} participantId={firstMsg.sender.id} size={28} rounded="9999px" gradientKey={senderColor} />
          </div>
        )}
        {showGroupStyle && !showSender && (
          <div className="w-7 flex-shrink-0" />
        )}

      <div>
        {/* Colored sender name for group chats */}
        {showGroupStyle && showSender && firstMsg.sender.name && (
          <span className="text-[11px] font-semibold block mb-1 ml-1" style={{ color: senderColor }}>{firstMsg.sender.name}</span>
        )}

      <div
        className="relative cursor-pointer group"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onImageClick(frontUrl)}
        style={{
          paddingTop: backCards.length >= 2 ? '16px' : backCards.length === 1 ? '10px' : '0',
          paddingRight: backCards.length >= 2 ? '16px' : backCards.length === 1 ? '10px' : '0',
        }}
      >
        {/* Back cards - fanned out behind the front */}
        {backCards.map((url, idx) => {
          const depth = backCards.length - idx;
          const rotation = depth * 5;
          const translateX = depth * 8;
          const translateY = depth * -8;

          return (
            <div
              key={idx}
              className="absolute rounded-[14px] overflow-hidden shadow-lg"
              style={{
                width: '220px',
                height: '170px',
                bottom: 0,
                left: 0,
                transform: `rotate(${rotation}deg) translate(${translateX}px, ${translateY}px)`,
                zIndex: idx,
                transition: 'transform 0.3s ease',
                ...(hovered && {
                  transform: `rotate(${rotation * 1.4}deg) translate(${translateX * 1.5}px, ${translateY * 1.3}px)`,
                }),
              }}
            >
              <img
                src={url}
                alt=""
                className="w-full h-full object-cover"
                onLoad={onImageLoad}
              />
              <div className="absolute inset-0 bg-black/10" />
            </div>
          );
        })}

        {/* Front card */}
        <div
          className="relative rounded-[14px] overflow-hidden shadow-xl transition-transform duration-300"
          style={{
            width: '220px',
            height: '170px',
            zIndex: 10,
            transform: hovered ? 'scale(1.02)' : 'scale(1)',
          }}
        >
          <img
            src={frontUrl}
            alt=""
            className="w-full h-full object-cover"
            onLoad={onImageLoad}
          />

          {/* Count badge */}
          <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
            </svg>
            {count}
          </div>

          {/* Hover overlay */}
          <div className={`absolute inset-0 bg-white/5 transition-opacity duration-200 ${hovered ? 'opacity-100' : 'opacity-0'}`} />
        </div>
      </div>

      <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end mr-1' : 'justify-start ml-1'}`}>
        <span className="text-[10px] text-[var(--text-3)]">{formatTime(lastMsg.timestamp)}</span>
      </div>
      </div>{/* close inner content wrapper */}
      </div>{/* close flex row with avatar */}
    </div>
  );
}
