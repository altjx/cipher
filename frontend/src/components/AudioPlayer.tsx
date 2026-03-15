import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Download } from 'lucide-react';

interface AudioPlayerProps {
  url: string;
  isMe?: boolean;
}

const BAR_COUNT = 40;
const BAR_GAP = 2;
const BAR_WIDTH = 2;

function generateWaveformBars(data: Float32Array, count: number): number[] {
  const bars: number[] = [];
  const samplesPerBar = Math.floor(data.length / count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    const start = i * samplesPerBar;
    for (let j = start; j < start + samplesPerBar && j < data.length; j++) {
      sum += Math.abs(data[j]);
    }
    const avg = sum / samplesPerBar;
    bars.push(Math.max(0.08, Math.min(1, avg * 4)));
  }
  return bars;
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ url, isMe = false }: AudioPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  // Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);   // audioCtx.currentTime when playback started
  const offsetRef = useRef<number>(0);       // offset into the buffer (for resume/seek)
  const rawBufRef = useRef<ArrayBuffer | null>(null); // raw bytes for download

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bars, setBars] = useState<number[] | null>(null);
  const [ready, setReady] = useState(false);

  // Fetch and decode audio on mount
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Reuse previously fetched raw bytes if available (handles React strict mode remount)
      let raw = rawBufRef.current;
      if (!raw) {
        const resp = await fetch(url);
        raw = await resp.arrayBuffer();
        if (cancelled) return;
        // Store an immutable copy so it survives strict-mode re-runs
        rawBufRef.current = raw.slice(0);
      }

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      // Always pass a fresh copy — decodeAudioData detaches/neuters the buffer
      const audioBuffer = await ctx.decodeAudioData(raw.slice(0));
      if (cancelled) {
        ctx.close();
        return;
      }
      audioBufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration);

      const channelData = audioBuffer.getChannelData(0);
      setBars(generateWaveformBars(channelData, BAR_COUNT));
      setReady(true);
    };

    init().catch((err) => {
      if (cancelled) return;
      console.error('[AudioPlayer] decode failed:', err);
      const fallback = Array.from({ length: BAR_COUNT }, (_, i) =>
        0.15 + 0.6 * Math.abs(Math.sin(i * 0.7))
      );
      setBars(fallback);
      setReady(true);
    });

    return () => {
      cancelled = true;
      sourceRef.current?.stop();
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, [url]);

  // Draw waveform
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bars) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const progress = duration > 0 ? currentTime / duration : 0;
    const h = rect.height;

    const playedColor = isMe ? 'rgba(255,255,255,0.95)' : 'var(--accent)';
    const unplayedColor = isMe ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)';

    for (let i = 0; i < bars.length; i++) {
      const x = i * (BAR_WIDTH + BAR_GAP);
      const barH = bars[i] * (h - 4);
      const y = (h - barH) / 2;
      const barProgress = (i + 0.5) / bars.length;

      ctx.fillStyle = barProgress <= progress ? playedColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(x, y, BAR_WIDTH, barH, 1);
      ctx.fill();
    }
  }, [bars, currentTime, duration, isMe]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Animation loop while playing
  useEffect(() => {
    if (!playing) return;

    const tick = () => {
      const ctx = audioCtxRef.current;
      if (ctx) {
        const elapsed = offsetRef.current + (ctx.currentTime - startTimeRef.current);
        if (elapsed >= duration) {
          setCurrentTime(0);
          offsetRef.current = 0;
          setPlaying(false);
          return;
        }
        setCurrentTime(elapsed);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [playing, duration]);

  const startPlayback = (offset: number) => {
    const ctx = audioCtxRef.current;
    const buffer = audioBufferRef.current;
    if (!ctx || !buffer) return;

    // Stop any existing source
    sourceRef.current?.stop();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current === source) {
        // Only reset if this is still the active source (not replaced by seek)
        const elapsed = offsetRef.current + (ctx.currentTime - startTimeRef.current);
        if (elapsed >= duration - 0.05) {
          setPlaying(false);
          setCurrentTime(0);
          offsetRef.current = 0;
        }
      }
    };

    sourceRef.current = source;
    offsetRef.current = offset;
    startTimeRef.current = ctx.currentTime;
    source.start(0, offset);
  };

  const togglePlay = () => {
    if (!ready || !audioBufferRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // Resume AudioContext if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    if (playing) {
      // Pause: record current offset and stop source
      const elapsed = offsetRef.current + (ctx.currentTime - startTimeRef.current);
      offsetRef.current = elapsed;
      sourceRef.current?.stop();
      sourceRef.current = null;
      setPlaying(false);
    } else {
      startPlayback(offsetRef.current);
      setPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const seekTo = pct * duration;

    setCurrentTime(seekTo);

    if (playing) {
      // Restart playback from new position
      startPlayback(seekTo);
    } else {
      offsetRef.current = seekTo;
    }
  };

  const handleDownload = () => {
    const buf = rawBufRef.current;
    if (!buf) return;
    const blob = new Blob([buf]);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'audio';
    a.click();
    URL.revokeObjectURL(objectUrl);
  };

  const waveformWidth = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP;

  return (
    <div className="flex items-center gap-2.5 min-w-[220px]">
      <button
        onClick={togglePlay}
        disabled={!ready}
        className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
          isMe
            ? 'bg-white/20 hover:bg-white/30 text-white'
            : 'bg-[var(--accent-soft)] hover:bg-[var(--accent)]/20 text-[var(--accent)]'
        } ${!ready ? 'opacity-40' : ''}`}
      >
        {playing ? (
          <Pause className="w-4 h-4" fill="currentColor" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
        )}
      </button>

      <div className="flex flex-col gap-0.5">
        <canvas
          ref={canvasRef}
          onClick={handleSeek}
          className="cursor-pointer h-[28px]"
          style={{ width: waveformWidth }}
        />
        <span className={`text-[10px] ${isMe ? 'text-white/50' : 'text-[var(--text-3)]'}`}>
          {playing || currentTime > 0
            ? formatDuration(currentTime)
            : formatDuration(duration)}
        </span>
      </div>

      <button
        onClick={handleDownload}
        className={`flex-shrink-0 p-1.5 rounded-full transition-colors ${
          isMe
            ? 'text-white/40 hover:text-white/70 hover:bg-white/10'
            : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-3)]'
        }`}
        title="Download"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
