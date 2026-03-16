import { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import type { Contact } from '../api/client';
import { fetchContacts, searchContacts, createConversation } from '../api/client';
import { avatarGradient } from '../utils/avatarGradient';

interface ComposeDialogProps {
  onConversationCreated: (conversationId: string) => void;
  onClose: () => void;
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function getInitials(name: string): string {
  return name
    .replace(EMOJI_RE, '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function ComposeDialog({ onConversationCreated, onClose }: ComposeDialogProps) {
  const [input, setInput] = useState('');
  const [initialContacts, setInitialContacts] = useState<Contact[]>([]);
  const [searchResults, setSearchResults] = useState<Contact[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
    fetchContacts()
      .then((res) => setInitialContacts(res.contacts))
      .catch(() => {});
  }, []);

  // Debounced live search against the phone's full contact list
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (input.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(() => {
      searchContacts(input)
        .then((res) => {
          setSearchResults(res.contacts);
          setSearching(false);
        })
        .catch(() => {
          setSearchResults(null);
          setSearching(false);
        });
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [input]);

  const displayContacts = searchResults ?? initialContacts.slice(0, 20);

  const handleCreate = async (number?: string) => {
    const target = number || input.trim();
    if (!target) return;

    setCreating(true);
    setError('');
    try {
      const conv = await createConversation([target]);
      onConversationCreated(conv.id);
    } catch {
      setError('Failed to create conversation. Check the phone number and try again.');
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      handleCreate();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  // Check if input looks like a phone number
  const isPhoneNumber = /^[+\d\s\-()]{3,}$/.test(input.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] w-full max-w-md mx-4 flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-[15px] font-semibold text-[var(--text)]">New conversation</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search / phone number input */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-3)]" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search contacts or enter phone number..."
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              className="w-full bg-[var(--surface-2)] text-[var(--text)] text-sm pl-10 pr-10 py-3 rounded-xl border border-[var(--border)] focus:border-[var(--accent)] focus:outline-none transition-colors placeholder-[var(--text-3)]"
            />
            {searching && (
              <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-3)] animate-spin" />
            )}
          </div>
          {error && <p className="text-xs text-red-400 mt-1.5 px-1">{error}</p>}
        </div>

        {/* Direct dial button for phone numbers */}
        {isPhoneNumber && input.trim().length >= 7 && (
          <div className="px-5 pb-3">
            <button
              onClick={() => handleCreate()}
              disabled={creating}
              className="w-full py-2.5 text-sm font-medium text-white bg-[var(--accent-2)] hover:bg-[var(--accent)] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              {creating ? 'Starting...' : `Message ${input.trim()}`}
            </button>
          </div>
        )}

        {/* Contact results */}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {searchResults !== null && input.length >= 2 && (
            <p className="text-[11px] text-[var(--text-3)] px-3 pb-2">
              {searching ? 'Searching phone contacts...' : `${searchResults.length} contact${searchResults.length !== 1 ? 's' : ''} found`}
            </p>
          )}
          {displayContacts.map((contact) => (
            <button
              key={contact.id + contact.number}
              onClick={() => handleCreate(contact.number)}
              disabled={creating}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer rounded-xl hover:bg-[rgba(255,255,255,0.04)] disabled:opacity-50"
            >
              <div
                className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-[12px] font-semibold"
                style={{ background: avatarGradient(contact.avatarColor || contact.name) }}
              >
                {getInitials(contact.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--text)] truncate">{contact.name}</p>
                {contact.number && <p className="text-[11px] text-[var(--text-3)]">{contact.number}</p>}
              </div>
            </button>
          ))}
          {!searching && displayContacts.length === 0 && input.length >= 2 && (
            <p className="text-center text-[var(--text-3)] text-xs py-4">
              {isPhoneNumber ? 'No contacts found — use the button above to message directly' : 'No contacts found'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
