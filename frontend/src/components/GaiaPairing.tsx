import { useState, useEffect, useCallback } from 'react';
import { startGaiaPairing } from '../api/client';
import type { WsGaiaPairError } from '../api/client';

type GaiaState = 'idle' | 'signing-in' | 'pairing' | 'waiting' | 'error';

interface GaiaPairingProps {
  subscribe: (eventType: 'pair_success' | 'gaia_pair_error', callback: (data: unknown) => void) => () => void;
  onPaired: () => void;
}

export default function GaiaPairing({ subscribe, onPaired }: GaiaPairingProps) {
  const [state, setState] = useState<GaiaState>('idle');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [emojiUrl, setEmojiUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isElectron = !!window.electronAPI?.googleSignIn;

  const startFlow = useCallback(async () => {
    if (!window.electronAPI?.googleSignIn) return;

    setState('signing-in');
    setError(null);

    try {
      const result = await window.electronAPI.googleSignIn();
      if (!result.cookies || result.cancelled) {
        setState('idle');
        return;
      }

      setState('pairing');

      const resp = await startGaiaPairing(result.cookies);
      setEmoji(resp.emoji);
      setEmojiUrl(resp.emojiUrl);
      setState('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, []);

  useEffect(() => {
    const unsubPair = subscribe('pair_success', () => {
      onPaired();
    });

    const unsubError = subscribe('gaia_pair_error', (data) => {
      const d = data as WsGaiaPairError['data'];
      setError(d.error);
      setState('error');
    });

    return () => {
      unsubPair();
      unsubError();
    };
  }, [subscribe, onPaired]);

  if (!isElectron) {
    return (
      <div className="text-center py-8">
        <p className="text-[var(--text-2)] text-sm">
          Google Account pairing requires the Cipher desktop app.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center">
      {state === 'idle' && (
        <>
          <p className="text-[var(--text-2)] mb-6 text-sm">
            Sign in with your Google account to pair
          </p>
          <button
            onClick={startFlow}
            className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
          >
            Sign in with Google
          </button>
          <div className="text-left text-sm text-[var(--text-2)] space-y-2 mt-8">
            <p>1. Click the button above to sign into your Google account</p>
            <p>2. An emoji will appear — find it on your phone and tap it</p>
            <p>3. Make sure <span className="text-[var(--text)]">Device pairing</span> is enabled in Google Messages</p>
          </div>
        </>
      )}

      {state === 'signing-in' && (
        <div className="py-8">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-2)] text-sm">Waiting for Google sign-in...</p>
          <p className="text-[var(--text-3)] text-xs mt-2">Complete the sign-in in the popup window</p>
        </div>
      )}

      {state === 'pairing' && (
        <div className="py-8">
          <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-2)] text-sm">Starting pairing...</p>
        </div>
      )}

      {state === 'waiting' && emoji && (
        <>
          <p className="text-[var(--text-2)] mb-6 text-sm">
            Tap this emoji on your phone to confirm pairing
          </p>
          <div className="flex justify-center mb-6">
            <div className="w-32 h-32 flex items-center justify-center bg-[var(--surface-2)] rounded-2xl">
              {emojiUrl ? (
                <img
                  src={emojiUrl}
                  alt={emoji}
                  className="w-24 h-24"
                  onError={(e) => {
                    // Fallback to text emoji if SVG fails
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.querySelector('span')!.style.display = 'block';
                  }}
                />
              ) : null}
              <span className="text-7xl" style={{ display: emojiUrl ? 'none' : 'block' }}>
                {emoji}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-[var(--text-3)] text-xs">
            <div className="w-4 h-4 border-2 border-[var(--text-3)] border-t-transparent rounded-full animate-spin" />
            Waiting for confirmation on your phone...
          </div>
        </>
      )}

      {state === 'error' && (
        <div className="py-4">
          <p className="text-red-400 text-sm mb-4">{error}</p>
          <button
            onClick={() => {
              setState('idle');
              setError(null);
              setEmoji(null);
              setEmojiUrl(null);
            }}
            className="px-6 py-2.5 bg-[var(--accent)] text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
