import { fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { VerdictControl } from './VerdictControl';

describe('verdict control', () => {
  const props = {
    containerRef: null,
    requested: false,
    approved: false,
    notYet: false,
    pendingCount: 0,
    conditionalSupported: true,
    disabled: false,
    approveDisabled: false,
    busy: false,
    onApprove: vi.fn(),
    onNotYet: vi.fn(),
    onRevoke: vi.fn(),
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
    const onApprove = vi.fn();
    const onNotYet = vi.fn();
    render(<VerdictControl {...props} onApprove={onApprove} onNotYet={onNotYet} />);

    fireEvent.click(buttons().getByRole('button', { name: 'Approve as-is' }));
    fireEvent.click(buttons().getByRole('button', { name: 'Approve after comments' }));
    fireEvent.click(buttons().getByRole('button', { name: 'Not yet' }));
    expect(onApprove.mock.calls).toEqual([['as-is'], ['after-comments']]);
    expect(onNotYet).toHaveBeenCalledOnce();
  });

  it('lists the same three verdicts in the narrow-screen menu', () => {
    const onApprove = vi.fn();
    const onNotYet = vi.fn();
    render(<VerdictControl {...props} onApprove={onApprove} onNotYet={onNotYet} />);

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Approve as-is Land/ }));
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Approve after comments are addressed/ }));
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Not yet Send/ }));
    expect(onApprove.mock.calls).toEqual([['as-is'], ['after-comments']]);
    expect(onNotYet).toHaveBeenCalledOnce();
  });

  it('marks the current verdict and names it on the menu button', () => {
    const { rerender } = render(<VerdictControl {...props} />);
    expect(screen.getByRole('button', { name: 'Verdict options' })).toHaveAttribute(
      'title',
      'Choose a verdict',
    );

    rerender(<VerdictControl {...props} requested approved mode="as-is" />);
    expect(buttons().getByRole('button', { name: 'Approved as-is' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(buttons().getByRole('button', { name: 'Not yet' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Verdict options' })).toHaveAttribute(
      'title',
      'Approved as-is',
    );

    rerender(<VerdictControl {...props} notYet />);
    expect(buttons().getByRole('button', { name: 'Not yet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(buttons().getByRole('button', { name: 'Approve as-is' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Verdict options' })).toHaveAttribute(
      'title',
      'Not yet',
    );
  });

  // Pending or complete, a chosen approval after comments is filled amber, as as-is is filled
  // green and Not yet red, in the color its hover border previews; its label says which.
  it('marks an approval after comments in amber and blocks it on older servers', () => {
    const { rerender } = render(
      <VerdictControl {...props} requested mode="after-comments" pendingCount={2} />,
    );
    const pending = buttons().getByRole('button', { name: 'Approved · 2 pending' });
    expect(pending).toHaveClass('bg-amber-700', 'text-white');
    rerender(<VerdictControl {...props} requested approved mode="after-comments" />);
    const done = buttons().getByRole('button', { name: 'Approved after comments' });
    expect(done).toHaveClass('bg-amber-700', 'text-white');
    expect(done).not.toHaveClass('bg-github-accent');
    expect(screen.getByRole('button', { name: 'Verdict options' })).toHaveClass('bg-amber-700');
    rerender(<VerdictControl {...props} conditionalSupported={false} />);
    expect(buttons().getByRole('button', { name: 'Approve after comments' })).toBeDisabled();
    openMenu();
    expect(
      screen.getByRole('button', { name: /^Approve after comments are addressed/ }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Approve as-is Land/ })).toBeEnabled();
  });

  it('returns every button to its idle colors once the verdict is cleared', () => {
    const { rerender } = render(<VerdictControl {...props} requested approved mode="as-is" />);
    expect(buttons().getByRole('button', { name: 'Approved as-is' })).toHaveClass(
      'bg-github-accent',
    );
    rerender(<VerdictControl {...props} />);
    expect(buttons().getByRole('button', { name: 'Approve as-is' })).toHaveClass(
      'bg-github-bg-tertiary',
    );
    expect(buttons().getByRole('button', { name: 'Not yet' })).toHaveClass('bg-github-bg-tertiary');
  });

  it('lets the reviewer say not yet while the summary is still loading', () => {
    render(<VerdictControl {...props} approveDisabled />);
    expect(buttons().getByRole('button', { name: 'Approve as-is' })).toBeDisabled();
    expect(buttons().getByRole('button', { name: 'Approve after comments' })).toBeDisabled();
    expect(buttons().getByRole('button', { name: 'Not yet' })).toBeEnabled();
  });

  it('blocks every verdict until the approval state and comments load', () => {
    render(<VerdictControl {...props} disabled />);
    for (const name of ['Approve as-is', 'Approve after comments', 'Not yet'])
      expect(buttons().getByRole('button', { name })).toBeDisabled();
  });

  it('clears the verdict when the pressed button is clicked again', () => {
    const onApprove = vi.fn();
    const onNotYet = vi.fn();
    const onRevoke = vi.fn();
    const handlers = { onApprove, onNotYet, onRevoke };
    const { rerender } = render(
      <VerdictControl {...props} {...handlers} requested approved mode="as-is" />,
    );
    const asIs = buttons().getByRole('button', { name: 'Approved as-is' });
    expect(asIs).toHaveAttribute('title', 'Clear this verdict');
    fireEvent.click(asIs);

    rerender(<VerdictControl {...props} {...handlers} requested mode="after-comments" />);
    fireEvent.click(buttons().getByRole('button', { name: 'Approved · 0 pending' }));

    rerender(<VerdictControl {...props} {...handlers} notYet />);
    fireEvent.click(buttons().getByRole('button', { name: 'Not yet' }));

    expect(onRevoke).toHaveBeenCalledTimes(3);
    expect(onApprove).not.toHaveBeenCalled();
    expect(onNotYet).not.toHaveBeenCalled();
  });

  // Red text measured 3.75:1 on the dark menu, the faintness rejected on the buttons; the icon
  // carries the color instead.
  it('keeps the menu Not yet label at full contrast, red only in its icon', () => {
    render(<VerdictControl {...props} />);
    openMenu();
    const item = screen.getByRole('button', { name: /^Not yet Send/ });
    expect(item.className).not.toMatch(/text-github-danger/);
    expect(item.querySelector('svg')).toHaveClass('text-github-danger');
  });

  // A double-click's second click lands on the button the first one pressed; it must not clear
  // the verdict the first click just gave.
  it('ignores the second click of a double-click on a pressed button', () => {
    const onRevoke = vi.fn();
    const { rerender } = render(
      <VerdictControl {...props} requested approved mode="as-is" onRevoke={onRevoke} />,
    );
    fireEvent.click(buttons().getByRole('button', { name: 'Approved as-is' }), { detail: 2 });
    rerender(<VerdictControl {...props} requested mode="after-comments" onRevoke={onRevoke} />);
    fireEvent.click(buttons().getByRole('button', { name: 'Approved · 0 pending' }), {
      detail: 2,
    });
    rerender(<VerdictControl {...props} notYet onRevoke={onRevoke} />);
    fireEvent.click(buttons().getByRole('button', { name: 'Not yet' }), { detail: 2 });
    expect(onRevoke).not.toHaveBeenCalled();
    // A keyboard press has detail 0 and still clears.
    fireEvent.click(buttons().getByRole('button', { name: 'Not yet' }), { detail: 0 });
    expect(onRevoke).toHaveBeenCalledOnce();
  });

  it('clears an approval or a not yet from the menu', () => {
    const onRevoke = vi.fn();
    const { rerender } = render(
      <VerdictControl {...props} requested approved mode="as-is" onRevoke={onRevoke} />,
    );
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Clear verdict' }));
    rerender(<VerdictControl {...props} notYet onRevoke={onRevoke} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Clear verdict' }));
    expect(onRevoke).toHaveBeenCalledTimes(2);
  });

  // Green or red text on the dark button measured about 3.3:1, too faint to read, so hover
  // tints only the border and the text keeps full contrast.
  it('keeps idle verdict buttons neutral, tinting only their border on hover', () => {
    render(<VerdictControl {...props} />);
    const notYet = buttons().getByRole('button', { name: 'Not yet' });
    const asIs = buttons().getByRole('button', { name: 'Approve as-is' });
    expect(notYet).toHaveClass('bg-github-bg-tertiary', 'enabled:hover:border-github-danger');
    expect(asIs).toHaveClass('enabled:hover:border-github-accent');
    // Amber, the fill it gets once chosen.
    const afterComments = buttons().getByRole('button', { name: 'Approve after comments' });
    expect(afterComments).toHaveClass('enabled:hover:border-amber-700');
    expect(afterComments.className).not.toMatch(/hover:border-github-accent/);
    for (const button of [notYet, asIs, afterComments]) {
      expect(button).toHaveClass('text-github-text-primary');
      expect(button.className).not.toMatch(/(^| )(text|border|bg)-github-(danger|accent)/);
      expect(button.className).not.toMatch(/hover:text-/);
    }
  });
});
