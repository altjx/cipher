import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Download from 'yet-another-react-lightbox/plugins/download';
import 'yet-another-react-lightbox/styles.css';

export interface LightboxImage {
  url: string;
  messageId: string;
  senderName: string;
  timestamp: number;
  isThumbnail?: boolean;
  actionMessageId?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  loadingFullSize?: boolean;
}

// Check if running in Electron
const electronAPI = (window as Record<string, unknown>).electronAPI as {
  openImageInPreview?: (url: string) => Promise<{ success: boolean }>;
} | undefined;

function BarIndicators({ total, current, onNavigate }: { total: number; current: number; onNavigate: (i: number) => void }) {
  if (total <= 1) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 14,
        left: 0,
        right: 0,
        zIndex: 99999,
        display: 'flex',
        justifyContent: 'center',
        gap: 5,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate(i); }}
          style={{
            width: i === current ? 32 : 10,
            height: 5,
            borderRadius: 3,
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            pointerEvents: 'auto',
            background: i === current ? '#ffffff' : 'rgba(255,255,255,0.4)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
            transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease',
          }}
        />
      ))}
    </div>
  );
}

export default function ImageLightbox({ images, currentIndex, onClose, onNavigate }: ImageLightboxProps) {
  const slides = images.map((img) => ({
    src: img.url,
  }));

  const handleOpenInPreview = () => {
    const img = images[currentIndex];
    if (!img) return;
    if (electronAPI?.openImageInPreview) {
      electronAPI.openImageInPreview(img.url);
    }
  };

  return (
    <>
      <style>{`
        .yarl__root {
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        /* Keep full backdrop, but pad the slides so images don't overlap the bars */
        .yarl__container {
          bottom: 0 !important;
        }
        .yarl__slide {
          padding-bottom: 40px !important;
        }
      `}</style>
      <Lightbox
        open
        close={onClose}
        index={currentIndex}
        slides={slides}
        plugins={[Zoom, Download]}
        on={{ view: ({ index }) => onNavigate(index) }}
        animation={{ fade: 200, swipe: 300 }}
        carousel={{ finite: true, preload: 2, spacing: '15%', imageFit: 'contain' }}
        zoom={{
          maxZoomPixelRatio: 3,
          scrollToZoom: true,
        }}
        toolbar={{
          buttons: [
            ...(electronAPI?.openImageInPreview
              ? [
                  <button
                    key="preview"
                    type="button"
                    className="yarl__button"
                    onClick={handleOpenInPreview}
                    title="Open in Preview"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>,
                ]
              : []),
            'download',
            'close',
          ],
        }}
        styles={{
          root: { '--yarl__color_backdrop': 'rgba(0, 0, 0, 0.5)' } as React.CSSProperties,
        }}
        controller={{ closeOnBackdropClick: true }}
      />
      <BarIndicators total={images.length} current={currentIndex} onNavigate={onNavigate} />
    </>
  );
}
