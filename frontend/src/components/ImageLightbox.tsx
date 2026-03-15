import Lightbox from 'yet-another-react-lightbox';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Download from 'yet-another-react-lightbox/plugins/download';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import 'yet-another-react-lightbox/plugins/counter.css';

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

export default function ImageLightbox({ images, currentIndex, onClose, onNavigate }: ImageLightboxProps) {
  const slides = images.map((img) => ({
    src: img.url,
  }));

  return (
    <>
      <style>{`
        .yarl__root {
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
      `}</style>
      <Lightbox
        open
        close={onClose}
        index={currentIndex}
        slides={slides}
        plugins={[Thumbnails, Zoom, Counter, Download]}
        on={{ view: ({ index }) => onNavigate(index) }}
        animation={{ fade: 200, swipe: 300 }}
        carousel={{ finite: true, preload: 2, spacing: '15%', imageFit: 'contain' }}
        thumbnails={{
          position: 'bottom',
          width: 80,
          height: 60,
          borderRadius: 6,
          gap: 8,
          padding: 4,
        }}
        zoom={{
          maxZoomPixelRatio: 3,
          scrollToZoom: true,
        }}
        styles={{
          root: { '--yarl__color_backdrop': 'rgba(0, 0, 0, 0.5)' } as React.CSSProperties,
        }}
        controller={{ closeOnBackdropClick: true }}
      />
    </>
  );
}
