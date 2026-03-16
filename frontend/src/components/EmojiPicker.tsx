import { useEffect, useRef } from 'react';
import Picker from 'emoji-picker-react';
import { Theme, EmojiStyle } from 'emoji-picker-react';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div ref={ref}>
      <Picker
        onEmojiClick={(emojiData) => onSelect(emojiData.emoji)}
        theme={Theme.DARK}
        emojiStyle={EmojiStyle.NATIVE}
        width={320}
        height={400}
        searchPlaceholder="Search emoji..."
        lazyLoadEmojis
      />
    </div>
  );
}
