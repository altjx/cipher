import { useState } from 'react';
import QRPairing from './QRPairing';
import GaiaPairing from './GaiaPairing';
import type { WsEventType } from '../api/client';

type PairingMethod = 'qr' | 'google';

interface PairingScreenProps {
  subscribe: (eventType: WsEventType, callback: (data: unknown) => void) => () => void;
  onPaired: () => void;
}

export default function PairingScreen({ subscribe, onPaired }: PairingScreenProps) {
  const [method, setMethod] = useState<PairingMethod>('google');

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)]">
      <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl p-10 max-w-md w-full mx-4 text-center shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <h1 className="text-2xl font-semibold text-[var(--text)] mb-6">
          Cipher
        </h1>

        {/* Method tabs */}
        <div className="flex rounded-lg bg-[var(--surface-2)] p-1 mb-8">
          <button
            onClick={() => setMethod('google')}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              method === 'google'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            Google Account
          </button>
          <button
            onClick={() => setMethod('qr')}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              method === 'qr'
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            QR Code
          </button>
        </div>

        {method === 'qr' ? (
          <QRPairing subscribe={subscribe} onPaired={onPaired} />
        ) : (
          <GaiaPairing subscribe={subscribe} onPaired={onPaired} />
        )}
      </div>
    </div>
  );
}
