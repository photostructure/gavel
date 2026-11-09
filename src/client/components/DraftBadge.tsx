import { Pencil } from 'lucide-react';

// Counts unsent comment drafts on the Conversation button. It uses a pencil and the
// comment form's yellow, so it reads apart from UnreadBadge's blue reply count.
export function DraftBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="draft-badge"
      className="inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full border border-yellow-600/60 bg-yellow-300 px-1 text-xs font-semibold leading-none text-black"
    >
      <Pencil size={10} />
      {count}
    </span>
  );
}
