import { useState } from 'react';
import { avatarGradient } from '../utils/avatarGradient';
import { avatarUrl } from '../api/client';

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

// Track which participant IDs have no avatar so we don't keep retrying
const failedIds = new Set<string>();

interface AvatarProps {
  name: string;
  participantId?: string;
  size?: number;
  rounded?: string;
  textSize?: string;
  gradientKey?: string; // override key for gradient color (e.g. avatarColor)
  className?: string;
}

export default function Avatar({ name, participantId, size = 44, rounded = '14px', textSize, gradientKey, className = '' }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const canShowImage = participantId && !failedIds.has(participantId) && !imgFailed;
  const initials = getInitials(name);
  const gradient = avatarGradient(gradientKey || name);
  const fontSize = textSize || `${Math.round(size * 0.34)}px`;

  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center text-white font-semibold overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        background: gradient,
        fontSize,
      }}
    >
      {canShowImage ? (
        <img
          src={avatarUrl(participantId)}
          alt=""
          className="w-full h-full object-cover"
          onError={() => {
            failedIds.add(participantId);
            setImgFailed(true);
          }}
        />
      ) : (
        initials
      )}
    </div>
  );
}
