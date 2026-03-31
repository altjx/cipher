import type { Conversation } from '../api/client';

export function getConversationActivityTimestamp(conv: Conversation): number {
  const messageTs = conv.lastMessage?.timestamp ?? 0;
  const reactionTs = conv.lastReaction?.timestamp ?? 0;
  return reactionTs > messageTs ? reactionTs : messageTs;
}

export function shouldShowReactionPreview(conv: Conversation): boolean {
  if (!conv.lastReaction) return false;
  const messageTs = conv.lastMessage?.timestamp ?? 0;
  return conv.lastReaction.timestamp > messageTs;
}

export function getReactionPreviewText(conv: Conversation): string {
  if (!conv.lastReaction) return '';
  const name = conv.lastReaction.reactorName || 'Someone';
  const emoji = conv.lastReaction.emoji ? ` ${conv.lastReaction.emoji}` : '';
  return `${name} reacted${emoji}`;
}
