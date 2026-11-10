import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { VerdictControl } from './VerdictControl';

describe('verdict control', () => {
  const props = {
    containerRef: null,
    conditionalSupported: true,
    disabled: false,
    approveDisabled: false,
    busy: false,
    onVerdict: vi.fn(),
    onClear: vi.fn(),
  };
  // Wide screens show the three verdicts as buttons; narrow ones list them in a menu.
  const buttons = () => within(screen.getByRole('group', { name: 'Verdict' }));
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Verdict options' }));

  it('anchors the celebration on the whole control, which stays visible at every width', () => {
    const containerRef = createRef<HTMLDivElement>();
    render(<VerdictControl {...props} containerRef={containerRef} />);

    expect(containerRef.current).toContainElement(
      screen.getByRole('button', { name: 'Verdict options' }),
    );
    expect(containerRef.current).toContainElement(screen.getByRole('group', { name: 'Verdict' }));
  });

  it('offers all three verdicts as buttons, each sending its own verdict in one click', () => {
    const onVerdict = vi.fn();
    render(<VerdictControl {...props} onVerdict={onVerdict} />);

    fireEvent.click(buttons().getByRole('button', { name: 'Approve as-is' }));
    fireEvent.click(buttons().getByRole('button', { name: 'Approve after comments' }));
    fireEvent.click(buttons().getByRole('button', { name: 'Reject' }));
    expect(onVerdict.mock.calls).toEqual([['as-is'], ['after-comments'], ['reject']]);
  });

  it('lists the same three verdicts in the narrow-screen menu', () => {
    const onVerdict = vi.fn();
    render(<VerdictControl {...props} onVerdict={onVerdict} />);

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Approve as-is Land/ }));
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Approve after comments are addressed/ }));
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Reject The agent stops/ }));
    expect(onVerdict.mock.calls).toEqual([['as-is'], ['after-comments'], ['reject']]);
  });

  it('marks the current verdict and names it on the menu button', () => {
    const { rerender } = render(<VerdictControl {...props} />);
    expect(screen.getByRole('button', { name: 'Verdict options' })).toHaveAttribute(
      'title',
      'Choose a verdict',
    );

    rerender(<VerdictControl {...props} verdict="as-is" />);
    expect(buttons().getByRole('button', { name: 'Approved as-is' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(buttons().getByRole('button', { name: 'Reject' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Verdict options' })).toHaveAttribute(
      'title',
      'Approved as-is',
    );

    rerender(<VerdictControl {...props} verdict="reject" />);
    expect(buttons().getByRole('button', { name: 'Reject' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(buttons().getByRole('button', { name: 'Approve as-is' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Verdict options' })).toHaveAttribute(
      'title',
      'Rejected',
    );
  });

  // Comments may live outside gavel, so this verdict neither counts them nor changes by itself.
  it('always shows an approval after comments in yellow with a bubble, and blocks older servers', () => {
    const bubble = '.lucide-message-square-more';
    const menuButton = () => screen.getByRole('button', { name: 'Verdict options' });
    const { rerender } = render(<VerdictControl {...props} verdict="after-comments" />);
    const chosen = buttons().getByRole('button', { name: 'Approved after comments' });
    expect(chosen).toHaveClass('bg-yellow-400', 'text-gray-900');
    expect(chosen).not.toHaveClass('bg-github-accent');
    expect(chosen.querySelector(bubble)).not.toBeNull();
    expect(chosen.querySelector('.lucide-check')).toBeNull();
    expect(menuButton()).toHaveClass('bg-yellow-400');
    expect(menuButton().querySelector(bubble)).not.toBeNull();
    rerender(<VerdictControl {...props} />);
    expect(
      buttons().getByRole('button', { name: 'Approve after comments' }).querySelector(bubble),
    ).not.toBeNull();
    rerender(<VerdictControl {...props} conditionalSupported={false} />);
    expect(buttons().getByRole('button', { name: 'Approve after comments' })).toBeDisabled();
    openMenu();
    expect(
      screen.getByRole('button', { name: /^Approve after comments are addressed/ }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Approve as-is Land/ })).toBeEnabled();
  });

  it('returns every button to its idle colors once the verdict is cleared', () => {
    const { rerender } = render(<VerdictControl {...props} verdict="as-is" />);
    expect(buttons().getByRole('button', { name: 'Approved as-is' })).toHaveClass(
      'bg-github-accent',
    );
    rerender(<VerdictControl {...props} />);
    expect(buttons().getByRole('button', { name: 'Approve as-is' })).toHaveClass(
      'bg-github-bg-tertiary',
    );
    expect(buttons().getByRole('button', { name: 'Reject' })).toHaveClass('bg-github-bg-tertiary');
  });

  it('lets the reviewer reject while the summary is still loading', () => {
    render(<VerdictControl {...props} approveDisabled />);
    expect(buttons().getByRole('button', { name: 'Approve as-is' })).toBeDisabled();
    expect(buttons().getByRole('button', { name: 'Approve after comments' })).toBeDisabled();
    expect(buttons().getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('blocks every verdict until the approval state and comments load', () => {
    render(<VerdictControl {...props} disabled />);
    for (const name of ['Approve as-is', 'Approve after comments', 'Reject'])
      expect(buttons().getByRole('button', { name })).toBeDisabled();
  });

  it('clears the verdict when the pressed button is clicked again', () => {
    const onVerdict = vi.fn();
    const onClear = vi.fn();
    const handlers = { onVerdict, onClear };
    const { rerender } = render(<VerdictControl {...props} {...handlers} verdict="as-is" />);
    const asIs = buttons().getByRole('button', { name: 'Approved as-is' });
    expect(asIs).toHaveAttribute('title', 'Clear this verdict');
    fireEvent.click(asIs);

    rerender(<VerdictControl {...props} {...handlers} verdict="after-comments" />);
    fireEvent.click(buttons().getByRole('button', { name: 'Approved after comments' }));

    rerender(<VerdictControl {...props} {...handlers} verdict="reject" />);
    fireEvent.click(buttons().getByRole('button', { name: 'Reject' }));

    expect(onClear).toHaveBeenCalledTimes(3);
    expect(onVerdict).not.toHaveBeenCalled();
  });

  // Violet text measures 3.75:1 on the dark menu, the faintness rejected on the buttons; the icon
  // carries the color instead.
  it('keeps the menu Reject label at full contrast, violet only in its icon', () => {
    render(<VerdictControl {...props} />);
    openMenu();
    const item = screen.getByRole('button', { name: /^Reject The agent stops/ });
    expect(item.className).not.toMatch(/text-verdict-reject/);
    expect(item.querySelector('svg')).toHaveClass('text-verdict-reject');
  });

  // A double-click's second click lands on the button the first one pressed; it must not clear
  // the verdict the first click just gave.
  it('ignores the second click of a double-click on a pressed button', () => {
    const onClear = vi.fn();
    const { rerender } = render(<VerdictControl {...props} verdict="as-is" onClear={onClear} />);
    fireEvent.click(buttons().getByRole('button', { name: 'Approved as-is' }), { detail: 2 });
    rerender(<VerdictControl {...props} verdict="after-comments" onClear={onClear} />);
    fireEvent.click(buttons().getByRole('button', { name: 'Approved after comments' }), {
      detail: 2,
    });
    rerender(<VerdictControl {...props} verdict="reject" onClear={onClear} />);
    fireEvent.click(buttons().getByRole('button', { name: 'Reject' }), { detail: 2 });
    expect(onClear).not.toHaveBeenCalled();
    // A keyboard press has detail 0 and still clears.
    fireEvent.click(buttons().getByRole('button', { name: 'Reject' }), { detail: 0 });
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('clears an approval or a rejection from the menu', () => {
    const onClear = vi.fn();
    const { rerender } = render(<VerdictControl {...props} verdict="as-is" onClear={onClear} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Clear verdict' }));
    rerender(<VerdictControl {...props} verdict="reject" onClear={onClear} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Clear verdict' }));
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  // Green or violet text on the dark button measures about 3.3:1, too faint to read, so hover
  // tints only the border and the text keeps full contrast.
  it('keeps idle verdict buttons neutral, tinting only their border on hover', () => {
    render(<VerdictControl {...props} />);
    const reject = buttons().getByRole('button', { name: 'Reject' });
    const asIs = buttons().getByRole('button', { name: 'Approve as-is' });
    expect(reject).toHaveClass('bg-github-bg-tertiary', 'enabled:hover:border-verdict-reject');
    expect(asIs).toHaveClass('enabled:hover:border-github-accent');
    // Yellow, like its fill once chosen.
    const afterComments = buttons().getByRole('button', { name: 'Approve after comments' });
    expect(afterComments).toHaveClass('enabled:hover:border-verdict-after-comments');
    expect(afterComments.className).not.toMatch(/hover:border-github-accent/);
    for (const button of [reject, asIs, afterComments]) {
      expect(button).toHaveClass('text-github-text-primary');
      expect(button.className).not.toMatch(/(^| )(text|border|bg)-(verdict-reject|github-accent)/);
      expect(button.className).not.toMatch(/hover:text-/);
    }
  });
});
