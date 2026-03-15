import { useState } from 'react';
import type { MediaItem } from '../api/client';
import { downloadMediaUrl } from '../api/client';

interface MediaPlayerProps {
  media: MediaItem[];
  messageId: string;
  onImageClick?: (url: string) => void;
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
}: {
  item: MediaItem;
  messageId: string;
  onClick?: (url: string) => void;
  compact?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const url = getMediaUrl(item, messageId);

  if (error) {
    return (
      <div
        className={`bg-[#2a2a3e] rounded-lg flex items-center justify-center text-gray-500 text-xs ${
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
          className={`bg-[#2a2a3e] rounded-lg animate-pulse ${
            compact ? 'w-full aspect-square' : 'w-[200px] h-[150px]'
          }`}
        />
      )}
      <img
        src={url}
        alt={item.fileName}
        className={`rounded-lg cursor-pointer hover:opacity-90 transition-opacity ${
          compact ? 'w-full aspect-square object-cover' : 'max-w-[300px]'
        } ${loaded ? '' : 'hidden'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        onClick={() => onClick?.(url)}
      />
    </div>
  );
}

function NonImageView({ item, messageId }: { item: MediaItem; messageId: string }) {
  const url = getMediaUrl(item, messageId);
  const mime = item.mimeType;

  if (mime.startsWith('video/')) {
    return <video src={url} controls className="max-w-[300px] rounded-lg" />;
  }

  if (mime.startsWith('audio/')) {
    return <audio src={url} controls className="w-full" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#4361ee] underline text-sm"
    >
      {item.fileName}
    </a>
  );
}

export default function MediaPlayer({ media, messageId, onImageClick }: MediaPlayerProps) {
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
        />
      )}
      {images.length === 2 && (
        <div className="grid grid-cols-2 gap-1 max-w-[300px] rounded-lg overflow-hidden">
          {images.map((item, idx) => (
            <ImageView
              key={item.id || item.thumbnailMediaId || idx}
              item={item}
              messageId={messageId}
              onClick={onImageClick}
              compact
            />
          ))}
        </div>
      )}
      {images.length === 3 && (
        <div className="grid grid-cols-2 gap-1 max-w-[300px] rounded-lg overflow-hidden">
          <div className="row-span-2">
            <ImageView
              item={images[0]}
              messageId={messageId}
              onClick={onImageClick}
              compact
            />
          </div>
          {images.slice(1).map((item, idx) => (
            <ImageView
              key={item.id || item.thumbnailMediaId || idx}
              item={item}
              messageId={messageId}
              onClick={onImageClick}
              compact
            />
          ))}
        </div>
      )}
      {images.length >= 4 && (
        <div className="grid grid-cols-2 gap-1 max-w-[300px] rounded-lg overflow-hidden">
          {images.slice(0, 4).map((item, idx) => (
            <ImageView
              key={item.id || item.thumbnailMediaId || idx}
              item={item}
              messageId={messageId}
              onClick={onImageClick}
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
        />
      ))}
    </div>
  );
}
