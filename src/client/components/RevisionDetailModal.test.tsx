import { fireEvent, render, screen } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

import { RevisionDetailModal } from './RevisionDetailModal';

describe('RevisionDetailModal', () => {
  // The header's toasts float at z-50 above Conversation; this dialog sits above them, below the
  // tooltips (z-[60]), so a toast cannot cover it or take its clicks.
  it('sits above the header toasts', () => {
    render(
      <HotkeysProvider>
        <RevisionDetailModal
          isOpen
          onClose={vi.fn()}
          options={{ specialOptions: [], branches: [], commits: [] }}
          selection={{ baseCommitish: 'HEAD', targetCommitish: '.' }}
          onApply={vi.fn()}
        />
      </HotkeysProvider>,
    );
    expect(document.querySelector('.fixed.inset-0')).toHaveClass('z-[55]');
  });

  it('clears hidden merge-base state when applying', () => {
    const onApply = vi.fn();

    render(
      <HotkeysProvider>
        <RevisionDetailModal
          isOpen
          onClose={vi.fn()}
          options={{
            specialOptions: [
              { value: '.', label: 'All Uncommitted Changes' },
              { value: 'staged', label: 'Staging Area' },
              { value: 'working', label: 'Working Directory' },
            ],
            branches: [{ name: 'main', current: true }],
            commits: [{ hash: 'abc1234', shortHash: 'abc1234', message: 'Commit A' }],
          }}
          selection={{
            baseCommitish: 'origin/main',
            targetCommitish: '.',
            baseMode: 'merge-base',
          }}
          onApply={onApply}
        />
      </HotkeysProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith({
      baseCommitish: 'origin/main',
      targetCommitish: '.',
    });
  });
});
