import { useState } from 'react';
import type { MediaItem } from '../api/client';
import { downloadMediaUrl } from '../api/client';
import AudioPlayer from './AudioPlayer';

interface MediaPlayerProps {
  media: MediaItem[];
  messageId: string;
  isMe?: boolean;
  onImageClick?: (url: string) => void;
  onImageLoad?: () => void;
}

export function getMediaUrl(item: MediaItem, messageId: string): string {
  const mediaId = item.id || item.thumbnailMediaId || '';
  if (!mediaId && item.inlineData) {
    // Only use inline data if there's no downloadable ID at all
    return `data:${item.mimeType};base64,${item.inlineData}`;
  }
  return downloadMediaUrl(messageId, mediaId);
}

function ImageView({
  item,
  messageId,
  onClick,
  compact,
  onLoad: onLoadProp,
}: {
  item: MediaItem;
  messageId: string;
  onClick?: (url: string) => void;
  compact?: boolean;
  onLoad?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const url = getMediaUrl(item, messageId);

  if (error) {
    return (
      <div
        className={`bg-[var(--surface-3)] rounded-[14px] flex items-center justify-center text-[var(--text-3)] text-xs ${
          compact ? 'w-full aspect-square' : 'w-[200px] h-[150px]'
        }`}
      >
        Failed to load image
      </div>
    );
  }

  return (
    <div className={`relative ${compact ? 'w-full' : ''}`}>
      {!loaded && (
        <div
          className={`bg-[var(--surface-3)] rounded-[14px] animate-pulse ${
            compact ? 'w-full aspect-square' : 'w-[200px] h-[150px]'
          }`}
        />
      )}
      <img
        src={url}
        alt={item.fileName}
        className={`rounded-[14px] cursor-pointer hover:opacity-90 transition-opacity ${
          compact ? 'w-full aspect-square object-cover' : 'max-w-[300px] min-h-[150px]'
        } ${loaded ? '' : 'hidden'}`}
        onLoad={() => { setLoaded(true); onLoadProp?.(); }}
        onError={() => setError(true)}
        onClick={() => onClick?.(url)}
      />
    </div>
  );
}

function NonImageView({ item, messageId, isMe }: { item: MediaItem; messageId: string; isMe?: boolean }) {
  const url = getMediaUrl(item, messageId);
  const mime = item.mimeType;

  if (mime.startsWith('video/')) {
    return <video src={url} controls className="max-w-[300px] rounded-[14px]" />;
  }

  if (mime.startsWith('audio/')) {
    return <AudioPlayer url={url} isMe={isMe} />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--accent)] underline text-sm"
    >
      {item.fileName}
    </a>
  );
}

export default function MediaPlayer({ media, messageId, isMe, onImageClick, onImageLoad }: MediaPlayerProps) {
  if (media.length === 0) return null;

  const images = media.filter((m) => m.mimeType.startsWith('image/'));
  const nonImages = media.filter((m) => !m.mimeType.startsWith('image/'));

  return (
    <div className="flex flex-col gap-2 mb-1">
      {/* Render images in a grid if multiple */}
      {images.length === 1 && (
        <ImageView
          item={images[0]}
          messageId={messageId}
          onClick={onImageClick}
          onLoad={onImageLoad}
        />
      )}
      {images.length === 2 && (
        <div className="grid grid-cols-2 gap-1 max-w-[300px] rounded-[14px] overflow-hidden">
          {images.map((item, idx) => (
            <ImageView
              key={item.id || item.thumbnailMediaId || idx}
              item={item}
              messageId={messageId}
              onClick={onImageClick}
              onLoad={onImageLoad}
              compact
            />
          ))}
        </div>
      )}
      {images.length === 3 && (
        <div className="grid grid-cols-2 gap-1 max-w-[300px] rounded-[14px] overflow-hidden">
          <div className="row-span-2">
            <ImageView
              item={images[0]}
              messageId={messageId}
              onClick={onImageClick}
              onLoad={onImageLoad}
              compact
            />
          </div>
          {images.slice(1).map((item, idx) => (
            <ImageView
              key={item.id || item.thumbnailMediaId || idx}
              item={item}
              messageId={messageId}
              onClick={onImageClick}
              onLoad={onImageLoad}
              compact
            />
          ))}
        </div>
      )}
      {images.length >= 4 && (
        <div className="grid grid-cols-2 gap-1 max-w-[300px] rounded-[14px] overflow-hidden">
          {images.slice(0, 4).map((item, idx) => (
            <ImageView
              key={item.id || item.thumbnailMediaId || idx}
              item={item}
              messageId={messageId}
              onClick={onImageClick}
              onLoad={onImageLoad}
              compact
            />
          ))}
        </div>
      )}

      {/* Non-image media */}
      {nonImages.map((item, idx) => (
        <NonImageView
          key={item.id || item.thumbnailMediaId || idx}
          item={item}
          messageId={messageId}
          isMe={isMe}
        />
      ))}
    </div>
  );
}
