// pulse: non-zero while the count should draw attention; a changed value restarts it.
export function UnreadBadge({ count, pulse = 0 }: { count: number; pulse?: number }) {
  if (count === 0) return null;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-xs font-semibold leading-none text-white${pulse > 0 ? ` unread-pulse-${pulse % 2}` : ''}`}
    >
      {count}
    </span>
  );
}
