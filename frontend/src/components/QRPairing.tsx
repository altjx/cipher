import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { startPairing } from '../api/client';
import type { WsQrRefresh } from '../api/client';

interface QRPairingProps {
  subscribe: (eventType: 'qr_refresh' | 'pair_success', callback: (data: unknown) => void) => () => void;
  onPaired: () => void;
}

export default function QRPairing({ subscribe, onPaired }: QRPairingProps) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    startPairing()
      .then((res) => {
        if (!cancelled) {
          setQrUrl(res.qrUrl);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unsubQr = subscribe('qr_refresh', (data) => {
      const d = data as WsQrRefresh['data'];
      setQrUrl(d.qrUrl);
    });

    const unsubPair = subscribe('pair_success', () => {
      onPaired();
    });

    return () => {
      unsubQr();
      unsubPair();
    };
  }, [subscribe, onPaired]);

  return (
    <div className="text-center">
      <p className="text-[var(--text-2)] mb-6 text-sm">
        Scan the QR code with your phone to pair
      </p>

      <div className="flex justify-center mb-6">
        {loading && (
          <div className="w-[256px] h-[256px] bg-[var(--surface-2)] rounded-lg animate-pulse flex items-center justify-center">
            <span className="text-[var(--text-3)] text-sm">Loading...</span>
          </div>
        )}
        {error && (
          <div className="w-[256px] h-[256px] bg-[var(--surface-2)] rounded-lg flex items-center justify-center">
            <span className="text-red-400 text-sm">{error}</span>
          </div>
        )}
        {!loading && !error && qrUrl && (
          <div className="bg-white p-4 rounded-lg">
            <QRCodeSVG value={qrUrl} size={224} />
          </div>
        )}
      </div>

      <div className="text-left text-sm text-[var(--text-2)] space-y-2">
        <p>1. Open Google Messages on your phone</p>
        <p>2. Tap <span className="text-[var(--text)]">Device pairing</span> in the menu</p>
        <p>3. Tap <span className="text-[var(--text)]">QR code scanner</span></p>
        <p>4. Point your phone at this screen to scan the code</p>
      </div>
    </div>
  );
}
