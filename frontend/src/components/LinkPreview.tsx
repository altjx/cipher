import { useState, useEffect } from 'react';
import { fetchLinkPreview, type LinkPreview as LinkPreviewData } from '../api/client';
import { ExternalLink } from 'lucide-react';

function proxyImageUrl(url: string): string {
  if (!url) return '';
  return `/api/link-preview/image?url=${encodeURIComponent(url)}`;
}

const URL_RE = /https?:\/\/[^\s<]+/;

// In-memory cache so re-renders don't re-fetch
const previewCache = new Map<string, LinkPreviewData | null>();

interface LinkPreviewProps {
  text: string;
  isMe: boolean;
}

export default function LinkPreview({ text, isMe }: LinkPreviewProps) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const match = text.match(URL_RE);
  const url = match?.[0] ?? null;

  useEffect(() => {
    if (!url) return;

    // Check memory cache
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) ?? null);
      return;
    }

    setLoading(true);
    fetchLinkPreview(url)
      .then((data) => {
        // Only show preview if there's meaningful content
        const hasContent = data.title || data.description || data.imageUrl;
        const result = hasContent ? data : null;
        previewCache.set(url, result);
        setPreview(result);
      })
      .catch(() => {
        previewCache.set(url, null);
        setPreview(null);
      })
      .finally(() => setLoading(false));
  }, [url]);

  if (!url || (!loading && !preview)) return null;

  if (loading) {
    return (
      <div className="mt-2 rounded-lg overflow-hidden border border-white/10 animate-pulse">
        <div className={`h-20 ${isMe ? 'bg-white/10' : 'bg-[var(--surface-3)]'}`} />
      </div>
    );
  }

  if (!preview) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-2 block rounded-lg overflow-hidden border transition-opacity hover:opacity-90 ${
        isMe ? 'border-white/15' : 'border-[var(--border)]'
      }`}
    >
      {preview.imageUrl && (
        <div className={`w-full h-32 overflow-hidden ${isMe ? 'bg-white/10' : 'bg-[var(--surface-3)]'}`}>
          <img
            src={proxyImageUrl(preview.imageUrl)}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
      <div className={`px-3 py-2 ${isMe ? 'bg-white/10' : 'bg-[var(--surface-3)]'}`}>
        {preview.title && (
          <p className={`text-xs font-semibold leading-snug line-clamp-2 ${isMe ? 'text-white' : 'text-[var(--text)]'}`}>
            {preview.title}
          </p>
        )}
        {preview.description && (
          <p className={`text-[11px] leading-snug mt-0.5 line-clamp-2 ${isMe ? 'text-white/70' : 'text-[var(--text-2)]'}`}>
            {preview.description}
          </p>
        )}
        <div className={`flex items-center gap-1 mt-1 ${isMe ? 'text-white/50' : 'text-[var(--text-3)]'}`}>
          {preview.faviconUrl ? (
            <img
              src={proxyImageUrl(preview.faviconUrl)}
              alt=""
              className="w-3 h-3 rounded-sm"
              onError={(e) => {
                // Fall back to generic icon if favicon fails
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <ExternalLink className={`w-3 h-3 ${preview.faviconUrl ? 'hidden' : ''}`} />
          <span className="text-[10px]">{preview.siteName || preview.domain}</span>
        </div>
      </div>
    </a>
  );
}
