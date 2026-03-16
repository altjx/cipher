import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search, MessageCircle, ArrowRight, PanelLeftClose,
  Info, ChevronLeft, ChevronRight, Keyboard, Command, Palette, Check,
} from 'lucide-react';
import type { Conversation } from '../api/client';
import { avatarGradient } from '../utils/avatarGradient';
import { themeOrder, themeMap, applyTheme } from '../config/themes';
import { useTheme } from '../context/ThemeContext';

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

// ---- Command definitions ----

interface CommandDef {
  id: string;
  label: string;
  category: 'Navigation' | 'Search' | 'View';
  keywords: string[];
  icon: React.ReactNode;
  shortcut?: string;
  action: string;
  requiresConversation?: boolean;
}

const COMMANDS: CommandDef[] = [
  {
    id: 'goto',
    label: 'Go to conversation...',
    category: 'Navigation',
    keywords: ['jump', 'open', 'switch', 'find', 'contact', 'person'],
    icon: <MessageCircle className="w-4 h-4" />,
    shortcut: '⌘G',
    action: 'goto',
  },
  {
    id: 'prev-conversation',
    label: 'Previous conversation',
    category: 'Navigation',
    keywords: ['back', 'up', 'before'],
    icon: <ChevronLeft className="w-4 h-4" />,
    shortcut: '⌘[',
    action: 'prev',
  },
  {
    id: 'next-conversation',
    label: 'Next conversation',
    category: 'Navigation',
    keywords: ['forward', 'down', 'after'],
    icon: <ChevronRight className="w-4 h-4" />,
    shortcut: '⌘]',
    action: 'next',
  },
  {
    id: 'search-conversation',
    label: 'Find in conversation',
    category: 'Search',
    keywords: ['search', 'find', 'text', 'message', 'filter'],
    icon: <Search className="w-4 h-4" />,
    shortcut: '⌘F',
    action: 'find-in-conversation',
    requiresConversation: true,
  },
  {
    id: 'search-all',
    label: 'Search all messages',
    category: 'Search',
    keywords: ['global', 'find', 'everywhere', 'all conversations'],
    icon: <Search className="w-4 h-4" />,
    shortcut: '⌘S',
    action: 'search-all',
  },
  {
    id: 'change-theme',
    label: 'Change theme...',
    category: 'View',
    keywords: ['theme', 'dark', 'light', 'color', 'appearance', 'mode', 'dracula', 'nord', 'github', 'solarized', 'monokai', 'tokyo'],
    icon: <Palette className="w-4 h-4" />,
    shortcut: '⌘T',
    action: 'change-theme',
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle sidebar',
    category: 'View',
    keywords: ['hide', 'show', 'panel', 'left', 'conversations', 'list', 'collapse'],
    icon: <PanelLeftClose className="w-4 h-4" />,
    shortcut: '⌘L',
    action: 'toggle-sidebar',
  },
  {
    id: 'toggle-info',
    label: 'Toggle info panel',
    category: 'View',
    keywords: ['detail', 'contact', 'right', 'participants', 'information'],
    icon: <Info className="w-4 h-4" />,
    shortcut: '⌘I',
    action: 'toggle-info',
    requiresConversation: true,
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    category: 'View',
    keywords: ['help', 'keys', 'bindings', 'hotkeys'],
    icon: <Keyboard className="w-4 h-4" />,
    action: 'show-shortcuts',
  },
];

const CATEGORY_ORDER: CommandDef['category'][] = ['Navigation', 'Search', 'View'];

// ---- Keyboard shortcut reference ----

const SHORTCUT_LIST = [
  { keys: '⌘ K', description: 'Open command palette' },
  { keys: '⌘ N', description: 'New conversation' },
  { keys: '⌘ G', description: 'Go to conversation' },
  { keys: '⌘ [', description: 'Previous conversation' },
  { keys: '⌘ ]', description: 'Next conversation' },
  { keys: '⌘ F', description: 'Find in conversation' },
  { keys: '⌘ S', description: 'Search all messages' },
  { keys: '⌘ L', description: 'Toggle sidebar' },
  { keys: '⌘ I', description: 'Toggle info panel' },
  { keys: '⌘ T', description: 'Change theme' },
  { keys: '⌘ D', description: 'Delete conversation' },
  { keys: '⌘ 1-7', description: 'Insert emoji (💯❤️😂👍😮😢🙏)' },
  { keys: '⌘ X, 1-7', description: 'React to last message' },
];

// ---- Ordered themes for the picker ----

const orderedThemes = themeOrder.map((id) => themeMap.get(id)!).filter(Boolean);

// ---- Component ----

type PaletteMode = 'commands' | 'goto' | 'shortcuts' | 'themes';

interface CommandPaletteProps {
  conversations: Conversation[];
  hasConversation: boolean;
  initialMode?: 'commands' | 'goto' | 'themes';
  onAction: (action: string) => void;
  onSelectConversation: (id: string) => void;
  onClose: () => void;
}

export default function CommandPalette({
  conversations,
  hasConversation,
  initialMode = 'commands',
  onAction,
  onSelectConversation,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { themeId, setTheme } = useTheme();
  const originalThemeRef = useRef(themeId);

  // When opened directly in themes mode (e.g. Cmd+T), set up the original theme ref
  useEffect(() => {
    if (initialMode === 'themes') {
      originalThemeRef.current = themeId;
      const currentIdx = orderedThemes.findIndex((t) => t.id === themeId);
      setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input on mount and mode change
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  // Reset selection & query on mode change
  const switchMode = useCallback((m: PaletteMode) => {
    // Revert theme preview when leaving themes mode without selecting
    if (mode === 'themes' && m !== 'themes') {
      applyTheme(originalThemeRef.current);
    }
    setMode(m);
    setQuery('');
    setSelectedIndex(0);
  }, [mode]);

  // ---- Theme preview on arrow key navigation ----
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Commands mode ----
  const availableCommands = useMemo(() => {
    return COMMANDS.filter((c) => {
      if (c.requiresConversation && !hasConversation) return false;
      return true;
    });
  }, [hasConversation]);

  const filteredCommands = useMemo(() => {
    if (!query) return availableCommands;
    const q = query.toLowerCase();
    return availableCommands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.some((kw) => kw.includes(q))
    );
  }, [availableCommands, query]);

  const groupedCommands = useMemo(() => {
    const groups: { category: string; items: CommandDef[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = filteredCommands.filter((c) => c.category === cat);
      if (items.length > 0) groups.push({ category: cat, items });
    }
    return groups;
  }, [filteredCommands]);

  const flatCommands = useMemo(() => groupedCommands.flatMap((g) => g.items), [groupedCommands]);

  // ---- Go-to mode ----
  const filteredConversations = useMemo(() => {
    if (!query) return conversations;
    const q = query.toLowerCase();
    return conversations.filter((c) => c.name.toLowerCase().includes(q));
  }, [conversations, query]);

  const gotoResults = filteredConversations.slice(0, 20);

  // ---- Themes mode ----
  const filteredThemes = useMemo(() => {
    if (!query) return orderedThemes;
    const q = query.toLowerCase();
    return orderedThemes.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [query]);

  // ---- Current item list length ----
  const itemCount =
    mode === 'commands' ? flatCommands.length :
    mode === 'goto' ? gotoResults.length :
    mode === 'themes' ? filteredThemes.length :
    0;

  // Clamp selected index when items change (skip for themes mode — it sets its own index)
  const prevQueryRef = useRef(query);
  const prevModeRef = useRef(mode);
  const skipResetRef = useRef(false);
  if (prevQueryRef.current !== query || prevModeRef.current !== mode) {
    const modeChanged = prevModeRef.current !== mode;
    prevQueryRef.current = query;
    prevModeRef.current = mode;
    if (modeChanged && mode === 'themes') {
      skipResetRef.current = true;
    } else if (!skipResetRef.current && selectedIndex !== 0) {
      setSelectedIndex(0);
    } else {
      skipResetRef.current = false;
    }
  }

  // Preview theme when navigating with arrow keys
  useEffect(() => {
    if (mode !== 'themes') return;
    const theme = filteredThemes[selectedIndex];
    if (!theme) return;

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      applyTheme(theme.id);
    }, 100);

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [mode, selectedIndex, filteredThemes]);

  // Revert theme on unmount if in preview mode
  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll('[data-palette-item]');
    const item = items[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const executeCommand = useCallback(
    (cmd: CommandDef) => {
      if (cmd.action === 'goto') {
        switchMode('goto');
        return;
      }
      if (cmd.action === 'show-shortcuts') {
        switchMode('shortcuts');
        return;
      }
      if (cmd.action === 'change-theme') {
        originalThemeRef.current = themeId;
        const currentIdx = orderedThemes.findIndex((t) => t.id === themeId);
        setMode('themes');
        setQuery('');
        setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
        return;
      }
      onAction(cmd.action);
      onClose();
    },
    [onAction, onClose, switchMode, themeId]
  );

  const selectTheme = useCallback(
    (id: string) => {
      setTheme(id);
      originalThemeRef.current = id;
      onClose();
    },
    [setTheme, onClose]
  );

  const selectConversation = useCallback(
    (id: string) => {
      onSelectConversation(id);
      onClose();
    },
    [onSelectConversation, onClose]
  );

  const handleClose = useCallback(() => {
    // Revert theme preview if closing from themes mode
    if (mode === 'themes') {
      applyTheme(originalThemeRef.current);
    }
    onClose();
  }, [mode, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (mode !== 'commands') {
        switchMode('commands');
      } else {
        handleClose();
      }
      return;
    }

    if (e.key === 'Backspace' && !query && mode !== 'commands') {
      e.preventDefault();
      switchMode('commands');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1 < itemCount ? i + 1 : 0));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 >= 0 ? i - 1 : Math.max(0, itemCount - 1)));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'commands' && flatCommands[selectedIndex]) {
        executeCommand(flatCommands[selectedIndex]);
      } else if (mode === 'goto' && gotoResults[selectedIndex]) {
        selectConversation(gotoResults[selectedIndex].id);
      } else if (mode === 'themes' && filteredThemes[selectedIndex]) {
        selectTheme(filteredThemes[selectedIndex].id);
      }
    }
  };

  // ---- Render helpers ----
  const Kbd = ({ children }: { children: React.ReactNode }) => (
    <kbd className="text-[10px] text-[var(--text-3)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded border border-[var(--border)] font-mono">
      {children}
    </kbd>
  );

  const renderCommandsMode = () => {
    if (flatCommands.length === 0) {
      return <div className="text-center text-[var(--text-3)] text-sm py-6">No matching commands</div>;
    }

    let flatIdx = 0;
    return groupedCommands.map((group) => (
      <div key={group.category}>
        <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          {group.category}
        </div>
        {group.items.map((cmd) => {
          const idx = flatIdx++;
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={cmd.id}
              data-palette-item
              onClick={() => executeCommand(cmd)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
                isSelected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[rgba(255,255,255,0.03)]'
              }`}
            >
              <span className={`flex-shrink-0 ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'}`}>
                {cmd.icon}
              </span>
              <span className="flex-1 text-[13px] text-[var(--text)] text-left">{cmd.label}</span>
              {cmd.shortcut && <Kbd>{cmd.shortcut}</Kbd>}
              {isSelected && <ArrowRight className="w-3.5 h-3.5 text-[var(--text-3)] flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    ));
  };

  const renderGotoMode = () => {
    if (gotoResults.length === 0 && query) {
      return <div className="text-center text-[var(--text-3)] text-sm py-6">No conversations found</div>;
    }

    return gotoResults.map((conv, idx) => (
      <button
        key={conv.id}
        data-palette-item
        onClick={() => selectConversation(conv.id)}
        onMouseEnter={() => setSelectedIndex(idx)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
          idx === selectedIndex ? 'bg-[var(--accent-soft)]' : 'hover:bg-[rgba(255,255,255,0.03)]'
        }`}
      >
        <div
          className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-[12px] font-semibold"
          style={{ background: avatarGradient(conv.name) }}
        >
          {getInitials(conv.name)}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[13px] font-medium text-[var(--text)] truncate">{conv.name}</div>
          <div className="text-[11px] text-[var(--text-3)] truncate">
            {conv.isGroup ? 'Group' : conv.lastMessage?.text ? conv.lastMessage.text.slice(0, 50) : 'No messages'}
          </div>
        </div>
        {conv.unread && (
          <span className="w-2 h-2 bg-[var(--accent)] rounded-full flex-shrink-0" />
        )}
        {idx === selectedIndex && <ArrowRight className="w-3.5 h-3.5 text-[var(--text-3)] flex-shrink-0" />}
      </button>
    ));
  };

  const renderThemesMode = () => {
    if (filteredThemes.length === 0) {
      return <div className="text-center text-[var(--text-3)] text-sm py-6">No matching themes</div>;
    }

    return filteredThemes.map((theme, idx) => {
      const isCurrent = theme.id === originalThemeRef.current;
      const isSelected = idx === selectedIndex;
      return (
        <button
          key={theme.id}
          data-palette-item
          onClick={() => selectTheme(theme.id)}
          onMouseEnter={() => {
            setSelectedIndex(idx);
            applyTheme(theme.id);
          }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
            isSelected ? 'bg-[var(--accent-soft)]' : 'hover:bg-[rgba(255,255,255,0.03)]'
          }`}
        >
          {/* Color swatch */}
          <div className="flex gap-0.5 flex-shrink-0">
            {[theme.colors.bg, theme.colors['surface-1'], theme.colors.accent].map((color, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-full border border-[rgba(255,255,255,0.1)]"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <span className="text-[13px] text-[var(--text)]">{theme.name}</span>
            <span className="text-[11px] text-[var(--text-3)] ml-2">{theme.description}</span>
          </div>
          {isCurrent && (
            <span className="text-[10px] font-medium text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 rounded">
              Current
            </span>
          )}
          {isSelected && !isCurrent && <ArrowRight className="w-3.5 h-3.5 text-[var(--text-3)] flex-shrink-0" />}
          {isCurrent && isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent)] flex-shrink-0" />}
        </button>
      );
    });
  };

  const renderShortcutsMode = () => (
    <div className="px-4 py-3">
      <div className="space-y-1">
        {SHORTCUT_LIST.map((s) => (
          <div key={s.keys} className="flex items-center justify-between py-2 px-2 rounded-lg">
            <span className="text-[13px] text-[var(--text)]">{s.description}</span>
            <Kbd>{s.keys}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );

  const placeholder =
    mode === 'goto' ? 'Search conversations...' :
    mode === 'shortcuts' ? 'Keyboard shortcuts' :
    mode === 'themes' ? 'Search themes...' :
    'Type a command...';

  const breadcrumb =
    mode === 'goto' ? 'Go to' :
    mode === 'shortcuts' ? 'Shortcuts' :
    mode === 'themes' ? 'Themes' :
    null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative w-[520px] max-h-[60vh] bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-[0_16px_64px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          {breadcrumb ? (
            <button
              onClick={() => switchMode('commands')}
              className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)] bg-[var(--accent-soft)] px-2 py-1 rounded-lg hover:bg-[var(--accent-soft)] transition-colors flex-shrink-0 cursor-pointer"
            >
              <Command className="w-3 h-3" />
              {breadcrumb}
            </button>
          ) : (
            <Command className="w-5 h-5 text-[var(--text-3)] flex-shrink-0" />
          )}
          {mode === 'shortcuts' ? (
            <span className="flex-1 text-[var(--text-3)] text-base">Keyboard shortcuts</span>
          ) : (
            <input
              ref={inputRef}
              type="text"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-[var(--text)] text-base focus:outline-none placeholder-[var(--text-3)]"
            />
          )}
          <Kbd>ESC</Kbd>
        </div>

        {/* Content */}
        <div ref={listRef} className="overflow-y-auto py-1" style={{ maxHeight: 'calc(60vh - 120px)' }}>
          {mode === 'commands' && renderCommandsMode()}
          {mode === 'goto' && renderGotoMode()}
          {mode === 'themes' && renderThemesMode()}
          {mode === 'shortcuts' && renderShortcutsMode()}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-[var(--border)] flex items-center gap-4 text-[10px] text-[var(--text-3)]">
          {mode !== 'shortcuts' && (
            <>
              <span><Kbd>↑↓</Kbd> {mode === 'themes' ? 'preview' : 'navigate'}</span>
              <span><Kbd>↵</Kbd> select</span>
            </>
          )}
          {mode !== 'commands' && <span><Kbd>⌫</Kbd> back</span>}
          <span><Kbd>esc</Kbd> {mode !== 'commands' ? 'back' : 'close'}</span>
        </div>
      </div>
    </div>
  );
}
