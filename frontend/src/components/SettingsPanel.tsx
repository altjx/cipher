import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Play, Palette, Bell, Eye } from 'lucide-react';
import { themeOrder, themeMap } from '../config/themes';
import { useTheme } from '../context/ThemeContext';
import { getSendReadReceipts, setSendReadReceipts } from '../api/client';

interface SettingsPanelProps {
  onClose: () => void;
}

const orderedThemes = themeOrder.map((id) => themeMap.get(id)!).filter(Boolean);

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { themeId, setTheme } = useTheme();
  const [selectedSound, setSelectedSound] = useState<string>('');
  const [availableSounds, setAvailableSounds] = useState<string[]>([]);
  const [sendReadReceipts, setReadReceipts] = useState(getSendReadReceipts());
  const isElectron = !!window.electronAPI;
  const [loadingSounds, setLoadingSounds] = useState(isElectron);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch settings and available sounds on mount
  useEffect(() => {
    if (!window.electronAPI) return;

    Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getAvailableSounds(),
    ])
      .then(([settings, sounds]) => {
        setSelectedSound(settings.notificationSound);
        setAvailableSounds(sounds);
      })
      .catch(() => {})
      .finally(() => setLoadingSounds(false));
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSelectSound = useCallback(async (name: string) => {
    setSelectedSound(name);
    if (window.electronAPI) {
      await window.electronAPI.setNotificationSound(name);
      if (name) {
        window.electronAPI.previewSound(name);
      }
    }
  }, []);

  const handlePreviewSound = useCallback((e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (window.electronAPI && name) {
      window.electronAPI.previewSound(name);
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] w-full max-w-[480px] mx-4 flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--border)]">
          <h2 className="text-[16px] font-semibold text-[var(--text)]">Settings</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Appearance / Theme Section */}
          <div className="px-6 pt-5 pb-4">
            <div className="flex items-center gap-2 mb-4">
              <Palette className="w-4 h-4 text-[var(--text-3)]" />
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                Appearance
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {orderedThemes.map((theme) => {
                const isCurrent = theme.id === themeId;
                return (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id)}
                    className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all cursor-pointer ${
                      isCurrent
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] hover:border-[var(--text-3)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {/* Color swatch */}
                    <div
                      className="w-full h-8 rounded-lg overflow-hidden flex"
                      style={{ border: '1px solid rgba(128,128,128,0.15)' }}
                    >
                      <div className="flex-1" style={{ backgroundColor: theme.colors.bg }} />
                      <div className="flex-1" style={{ backgroundColor: theme.colors['surface-1'] }} />
                      <div className="flex-1" style={{ backgroundColor: theme.colors.accent }} />
                    </div>

                    <span className="text-[11px] font-medium text-[var(--text)] truncate w-full text-center">
                      {theme.name}
                    </span>

                    {/* Checkmark */}
                    {isCurrent && (
                      <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="mx-6 border-t border-[var(--border)]" />

          {/* Privacy Section */}
          <div className="px-6 pt-5 pb-4">
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-4 h-4 text-[var(--text-3)]" />
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                Privacy
              </h3>
            </div>

            <button
              onClick={() => {
                const next = !sendReadReceipts;
                setReadReceipts(next);
                setSendReadReceipts(next);
              }}
              className="w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[var(--text)] text-left">Send read receipts</p>
                <p className="text-[11px] text-[var(--text-3)] text-left mt-0.5">
                  Let others know when you've read their messages
                </p>
              </div>
              <div
                className={`w-10 h-[22px] rounded-full flex-shrink-0 transition-colors relative ${
                  sendReadReceipts ? 'bg-[var(--accent)]' : 'bg-[var(--surface-3)]'
                }`}
              >
                <div
                  className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    sendReadReceipts ? 'translate-x-[21px]' : 'translate-x-[3px]'
                  }`}
                />
              </div>
            </button>
          </div>

          {/* Divider */}
          <div className="mx-6 border-t border-[var(--border)]" />

          {/* Notification Sound Section */}
          <div className="px-6 pt-5 pb-5">
            <div className="flex items-center gap-2 mb-4">
              <Bell className="w-4 h-4 text-[var(--text-3)]" />
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                Notification Sound
              </h3>
            </div>

            {!isElectron ? (
              <div className="bg-[var(--surface-2)] rounded-xl px-4 py-3.5 text-[13px] text-[var(--text-3)]">
                Notification sounds are only available in the desktop app.
              </div>
            ) : loadingSounds ? (
              <div className="text-[13px] text-[var(--text-3)] py-4 text-center">
                Loading sounds...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {/* None option */}
                <button
                  onClick={() => handleSelectSound('')}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors cursor-pointer ${
                    selectedSound === ''
                      ? 'bg-[var(--accent-soft)]'
                      : 'hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    selectedSound === ''
                      ? 'border-[var(--accent)] bg-[var(--accent)]'
                      : 'border-[var(--text-3)]'
                  }`}>
                    {selectedSound === '' && <Check className="w-2 h-2 text-white" />}
                  </div>
                  <span className="flex-1 text-[12px] text-[var(--text)] text-left">None</span>
                </button>

                {/* Sound options */}
                {availableSounds.map((sound) => {
                  const isSelected = selectedSound === sound;
                  return (
                    <button
                      key={sound}
                      onClick={() => handleSelectSound(sound)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--accent-soft)]'
                          : 'hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent)]'
                          : 'border-[var(--text-3)]'
                      }`}>
                        {isSelected && <Check className="w-2 h-2 text-white" />}
                      </div>
                      <span className="flex-1 text-[12px] text-[var(--text)] text-left">{sound}</span>
                      <button
                        onClick={(e) => handlePreviewSound(e, sound)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] transition-colors cursor-pointer"
                        title={`Preview ${sound}`}
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
