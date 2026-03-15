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
    setLoading(true);
    setError(null);

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
    <div className="flex items-center justify-center min-h-screen bg-[#0f0f1a]">
      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-10 max-w-md w-full mx-4 text-center shadow-xl">
        <h1 className="text-2xl font-semibold text-[#e2e8f0] mb-2">
          Google Messages for Web
        </h1>
        <p className="text-gray-400 mb-8 text-sm">
          Scan the QR code with your phone to pair
        </p>

        <div className="flex justify-center mb-8">
          {loading && (
            <div className="w-[256px] h-[256px] bg-[#2a2a3e] rounded-lg animate-pulse flex items-center justify-center">
              <span className="text-gray-500 text-sm">Loading...</span>
            </div>
          )}
          {error && (
            <div className="w-[256px] h-[256px] bg-[#2a2a3e] rounded-lg flex items-center justify-center">
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}
          {!loading && !error && qrUrl && (
            <div className="bg-white p-4 rounded-lg">
              <QRCodeSVG value={qrUrl} size={224} />
            </div>
          )}
        </div>

        <div className="text-left text-sm text-gray-400 space-y-2">
          <p>1. Open Google Messages on your phone</p>
          <p>2. Tap <span className="text-[#e2e8f0]">Device pairing</span> in the menu</p>
          <p>3. Tap <span className="text-[#e2e8f0]">QR code scanner</span></p>
          <p>4. Point your phone at this screen to scan the code</p>
        </div>
      </div>
    </div>
  );
}
