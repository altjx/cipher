import { useState, useEffect, useCallback } from 'react';
import { FileText, Copy, Check } from 'lucide-react';
import type { Conversation, Message } from '../api/client';
import { fetchConversationMedia, downloadMediaUrl, requestFullSizeImage } from '../api/client';
import { avatarGradient } from '../utils/avatarGradient';
import ImageLightbox, { type LightboxImage } from './ImageLightbox';
import { getMediaUrl } from './MediaPlayer';

interface DetailPanelProps {
  conversationId: string;
  conversation: Conversation;
  focusParticipantId?: string | null;
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--surface-2)] transition-colors flex-shrink-0 cursor-pointer"
      title="Copy number"
    >
      {copied
        ? <Check className="w-3 h-3 text-green-400" />
        : <Copy className="w-3 h-3 text-[var(--text-3)]" />}
    </button>
  );
}

// Module-level cache so toggling the panel doesn't re-fetch
const mediaCache = new Map<string, Message[]>();

export default function DetailPanel({ conversationId, conversation, focusParticipantId: _focusParticipantId }: DetailPanelProps) {
  const cached = mediaCache.get(conversationId);
  const [mediaMessages, setMediaMessages] = useState<Message[]>(cached ?? []);
  const [loadingMedia, setLoadingMedia] = useState(!cached);

  useEffect(() => {
    let cancelled = false;

    // Restore from cache instantly if available
    const cached = mediaCache.get(conversationId);
    if (cached) {
      setMediaMessages(cached);
      setLoadingMedia(false);
    } else {
      setMediaMessages([]);
      setLoadingMedia(true);
    }

    // Always refresh in background
    fetchConversationMedia(conversationId)
      .then((res) => {
        if (!cancelled) {
          setMediaMessages(res.messages);
          setLoadingMedia(false);
          mediaCache.set(conversationId, res.messages);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingMedia(false);
      });

    return () => { cancelled = true; };
  }, [conversationId]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [loadingFullSize, setLoadingFullSize] = useState(false);
  const fullSizeRequestedRef = useState(() => new Set<string>())[0];

  // Separate images and files
  const images: { url: string; messageId: string; lightbox: LightboxImage }[] = [];
  const files: { name: string; messageId: string; mediaId: string }[] = [];

  for (const msg of mediaMessages) {
    for (const media of msg.media) {
      if (media.mimeType.startsWith('image/')) {
        const url = getMediaUrl(media, msg.id);
        images.push({
          url,
          messageId: msg.id,
          lightbox: {
            url,
            messageId: msg.id,
            senderName: msg.sender.name,
            timestamp: msg.timestamp,
            isThumbnail: media.isThumbnail,
            actionMessageId: media.actionMessageId,
          },
        });
      } else {
        files.push({ name: media.fileName, messageId: msg.id, mediaId: media.id });
      }
    }
  }

  const allLightboxImages = images.map((img) => img.lightbox);

  const handleImageClick = useCallback((index: number) => {
    setLightboxIndex(index);
    const img = allLightboxImages[index];
    if (img?.isThumbnail && img.actionMessageId) {
      const key = `${img.messageId}:${img.actionMessageId}`;
      if (!fullSizeRequestedRef.has(key)) {
        fullSizeRequestedRef.add(key);
        setLoadingFullSize(true);
        requestFullSizeImage(img.messageId, img.actionMessageId).catch(() => {});
      }
    }
  }, [allLightboxImages, fullSizeRequestedRef]);

  const handleLightboxNavigate = useCallback((idx: number) => {
    setLightboxIndex(idx);
    const img = allLightboxImages[idx];
    if (img?.isThumbnail && img.actionMessageId) {
      const key = `${img.messageId}:${img.actionMessageId}`;
      if (!fullSizeRequestedRef.has(key)) {
        fullSizeRequestedRef.add(key);
        setLoadingFullSize(true);
        requestFullSizeImage(img.messageId, img.actionMessageId).catch(() => {});
      }
    }
  }, [allLightboxImages, fullSizeRequestedRef]);

  return (
    <div className="w-[280px] min-w-[280px] bg-[var(--surface-1)] rounded-[20px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] p-6 overflow-y-auto flex flex-col">
      {/* Draggable title bar spacer */}
      <div className="titlebar-drag h-8 flex-shrink-0" />

      {/* Avatar */}
      <div
        className="w-[72px] h-[72px] rounded-[20px] flex items-center justify-center text-white text-[26px] font-bold mx-auto mb-3"
        style={{ background: avatarGradient(conversation.name) }}
      >
        {getInitials(conversation.name)}
      </div>

      {/* Name */}
      <div className="text-center text-[16px] font-semibold mb-0.5">{conversation.name}</div>
      <div className="text-center text-xs text-[var(--text-2)] mb-5 flex items-center justify-center gap-1">
        {conversation.isGroup
          ? `${conversation.participants.length} participants`
          : (() => {
              const number = conversation.participants.find((p) => !p.isMe)?.number;
              return number ? <><span>{number}</span><CopyButton text={number} /></> : 'RCS Contact';
            })()}
      </div>

      {/* Participants (group chats) */}
      {conversation.isGroup && (
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2.5">
            Participants
          </div>
          {conversation.participants.filter((p) => !p.isMe).map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 py-1.5">
              <div
                className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0"
                style={{ background: avatarGradient(p.avatarColor || '#3b82f6') }}
              >
                {getInitials(p.name)}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] truncate">{p.name}</div>
                {p.number && p.number !== p.name && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-[var(--text-3)] truncate">{p.number}</span>
                    <CopyButton text={p.number} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Shared Media */}
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2.5">
          Shared Media
        </div>
        {loadingMedia ? (
          <div className="text-xs text-[var(--text-3)]">Loading...</div>
        ) : images.length === 0 ? (
          <div className="text-xs text-[var(--text-3)]">No shared media</div>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {images.slice(0, 9).map((img, i) => (
              <div
                key={i}
                className="aspect-square rounded-lg overflow-hidden bg-[var(--surface-2)] cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => handleImageClick(i)}
              >
                <img
                  src={img.url}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Files */}
      {files.length > 0 && (
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2.5">
            Files
          </div>
          {files.map((file, i) => (
            <a
              key={i}
              href={downloadMediaUrl(file.messageId, file.mediaId)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 py-2 hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center">
                <FileText className="w-4 h-4 text-[var(--text-2)]" />
              </div>
              <span className="text-[13px] truncate">{file.name}</span>
            </a>
          ))}
        </div>
      )}

      {/* Image lightbox */}
      {lightboxIndex !== null && allLightboxImages.length > 0 && (
        <ImageLightbox
          images={allLightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => { setLightboxIndex(null); setLoadingFullSize(false); }}
          onNavigate={handleLightboxNavigate}
          loadingFullSize={loadingFullSize}
        />
      )}
    </div>
  );
}
