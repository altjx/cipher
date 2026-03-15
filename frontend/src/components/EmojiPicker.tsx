import { useEffect, useRef, useState, useMemo } from 'react';
import { Search } from 'lucide-react';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

interface EmojiEntry {
  emoji: string;
  keywords: string;
}

const CATEGORIES: { label: string; emojis: EmojiEntry[] }[] = [
  {
    label: 'Smileys',
    emojis: [
      { emoji: '😀', keywords: 'grin happy smile' }, { emoji: '😃', keywords: 'happy smile big' },
      { emoji: '😄', keywords: 'laugh smile happy' }, { emoji: '😁', keywords: 'grin teeth happy' },
      { emoji: '😆', keywords: 'laugh squint happy' }, { emoji: '😅', keywords: 'sweat laugh nervous' },
      { emoji: '🤣', keywords: 'rofl rolling laugh' }, { emoji: '😂', keywords: 'joy tears laugh cry' },
      { emoji: '🙂', keywords: 'smile slight' }, { emoji: '😊', keywords: 'blush smile happy' },
      { emoji: '😇', keywords: 'angel halo innocent' }, { emoji: '🥰', keywords: 'love hearts smile' },
      { emoji: '😍', keywords: 'love heart eyes' }, { emoji: '🤩', keywords: 'star eyes excited' },
      { emoji: '😘', keywords: 'kiss blow' }, { emoji: '😋', keywords: 'yum tongue delicious' },
      { emoji: '😜', keywords: 'wink tongue silly' }, { emoji: '🤪', keywords: 'crazy zany wild' },
      { emoji: '😎', keywords: 'cool sunglasses' }, { emoji: '🤗', keywords: 'hug hands open' },
      { emoji: '🤔', keywords: 'think hmm wonder' }, { emoji: '🫣', keywords: 'peek shy hide' },
      { emoji: '😐', keywords: 'neutral blank' }, { emoji: '😑', keywords: 'expressionless flat' },
      { emoji: '🙄', keywords: 'eye roll annoyed' }, { emoji: '😏', keywords: 'smirk sly' },
      { emoji: '😬', keywords: 'grimace awkward cringe' }, { emoji: '🤥', keywords: 'lie pinocchio' },
      { emoji: '😌', keywords: 'relieved peaceful calm' }, { emoji: '😴', keywords: 'sleep zzz tired' },
      { emoji: '🤤', keywords: 'drool yum' }, { emoji: '😷', keywords: 'mask sick' },
      { emoji: '🤢', keywords: 'nausea sick green' }, { emoji: '🤮', keywords: 'vomit puke sick' },
      { emoji: '🥵', keywords: 'hot sweat overheated' }, { emoji: '🥶', keywords: 'cold freeze frozen' },
      { emoji: '😱', keywords: 'scream shock horror' }, { emoji: '😭', keywords: 'sob cry sad wail' },
      { emoji: '🥺', keywords: 'pleading puppy sad' }, { emoji: '😤', keywords: 'angry huff steam' },
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      { emoji: '👍', keywords: 'thumbs up yes good like' }, { emoji: '👎', keywords: 'thumbs down no bad dislike' },
      { emoji: '👊', keywords: 'fist bump punch' }, { emoji: '✊', keywords: 'fist raised power' },
      { emoji: '🤛', keywords: 'fist left bump' }, { emoji: '🤜', keywords: 'fist right bump' },
      { emoji: '👏', keywords: 'clap hands bravo' }, { emoji: '🙌', keywords: 'hands raised celebrate' },
      { emoji: '🤝', keywords: 'handshake deal agree' }, { emoji: '🫶', keywords: 'heart hands love' },
      { emoji: '👐', keywords: 'open hands jazz' }, { emoji: '✌️', keywords: 'peace victory two' },
      { emoji: '🤟', keywords: 'love you hand rock' }, { emoji: '🤘', keywords: 'rock metal horns' },
      { emoji: '🤙', keywords: 'call shaka hang loose' }, { emoji: '💪', keywords: 'strong muscle flex' },
      { emoji: '🫡', keywords: 'salute respect' }, { emoji: '🙏', keywords: 'pray please thank you' },
      { emoji: '👋', keywords: 'wave hello goodbye hi bye' }, { emoji: '🖐️', keywords: 'hand stop five' },
    ],
  },
  {
    label: 'Hearts',
    emojis: [
      { emoji: '❤️', keywords: 'red heart love' }, { emoji: '🧡', keywords: 'orange heart' },
      { emoji: '💛', keywords: 'yellow heart' }, { emoji: '💚', keywords: 'green heart' },
      { emoji: '💙', keywords: 'blue heart' }, { emoji: '💜', keywords: 'purple heart' },
      { emoji: '🖤', keywords: 'black heart dark' }, { emoji: '🤍', keywords: 'white heart pure' },
      { emoji: '🤎', keywords: 'brown heart' }, { emoji: '💕', keywords: 'two hearts love' },
      { emoji: '💞', keywords: 'revolving hearts love' }, { emoji: '💓', keywords: 'beating heart love' },
      { emoji: '💗', keywords: 'growing heart love' }, { emoji: '💖', keywords: 'sparkling heart love' },
      { emoji: '💘', keywords: 'cupid arrow heart love' }, { emoji: '💝', keywords: 'gift heart ribbon love' },
      { emoji: '💔', keywords: 'broken heart sad' }, { emoji: '❤️‍🔥', keywords: 'heart fire passion' },
      { emoji: '❤️‍🩹', keywords: 'mending heart heal' }, { emoji: '♥️', keywords: 'heart suit love' },
    ],
  },
  {
    label: 'Objects',
    emojis: [
      { emoji: '🎉', keywords: 'party tada celebrate confetti' }, { emoji: '🎊', keywords: 'confetti ball celebrate' },
      { emoji: '🎈', keywords: 'balloon party' }, { emoji: '🎁', keywords: 'gift present wrapped' },
      { emoji: '🏆', keywords: 'trophy winner cup' }, { emoji: '⭐', keywords: 'star gold favorite' },
      { emoji: '🌟', keywords: 'star glow glowing' }, { emoji: '💫', keywords: 'dizzy star' },
      { emoji: '✨', keywords: 'sparkles shine magic' }, { emoji: '🔥', keywords: 'fire hot flame lit' },
      { emoji: '💯', keywords: 'hundred perfect score' }, { emoji: '🎵', keywords: 'music note' },
      { emoji: '🎶', keywords: 'music notes' }, { emoji: '☕', keywords: 'coffee tea hot' },
      { emoji: '🍕', keywords: 'pizza food' }, { emoji: '🍔', keywords: 'burger food hamburger' },
      { emoji: '🍿', keywords: 'popcorn movie snack' }, { emoji: '🎮', keywords: 'game controller gaming' },
      { emoji: '📱', keywords: 'phone mobile cell' }, { emoji: '💻', keywords: 'laptop computer' },
    ],
  },
];

// Flatten all emojis for search
const ALL_EMOJIS = CATEGORIES.flatMap((c) => c.emojis);

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Auto-focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const searchLower = search.toLowerCase();
  const filtered = useMemo(() => {
    if (!search) return null;
    return ALL_EMOJIS.filter((e) => e.keywords.includes(searchLower));
  }, [search, searchLower]);

  const displayEmojis = filtered ?? CATEGORIES[activeTab].emojis;

  return (
    <div
      ref={ref}
      className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-lg w-[280px] max-h-[360px] flex flex-col overflow-hidden z-20"
    >
      {/* Search input */}
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-3)]" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search emoji..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--surface-2)] text-[var(--text)] text-xs pl-8 pr-2 py-1.5 rounded-lg border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none placeholder-[var(--text-3)]"
          />
        </div>
      </div>

      {/* Category tabs (hidden when searching) */}
      {!search && (
        <div className="flex border-b border-[var(--border)] px-2 gap-1 pb-1">
          {CATEGORIES.map((cat, i) => (
            <button
              key={cat.label}
              onClick={() => setActiveTab(i)}
              className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${
                activeTab === i
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-3)] hover:bg-[rgba(255,255,255,0.04)]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {displayEmojis.length === 0 ? (
          <div className="text-center text-[var(--text-3)] text-xs py-4">No emojis found</div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {displayEmojis.map((entry) => (
              <button
                key={entry.emoji}
                onClick={() => onSelect(entry.emoji)}
                className="w-8 h-8 text-xl flex items-center justify-center hover:bg-[var(--surface-2)] rounded-lg transition-colors cursor-pointer"
                title={entry.keywords}
              >
                {entry.emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
