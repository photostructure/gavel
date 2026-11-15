import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastStack } from './ToastStack';

const stack = () => document.querySelector<HTMLElement>('[data-toast-stack]')!;

function placedAnchor(rect: DOMRect) {
  const anchor = document.createElement('div');
  document.body.append(anchor);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect);
  return anchor;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ToastStack', () => {
  it('floats outside the header so the header cannot clip it', () => {
    const header = document.createElement('header');
    header.style.overflow = 'hidden';
    document.body.append(header);
    const verdicts = document.createElement('div');
    header.append(verdicts);
    render(
      <ToastStack anchor={verdicts}>
        <div role="alert">Toast</div>
      </ToastStack>,
      { container: header },
    );
    expect(header).not.toContainElement(screen.getByRole('alert'));
  });

  // An absolute toast adds to the page's scroll size while it slides in from past the right edge,
  // or widens before it is repositioned, so a horizontal scrollbar flashes and the page jumps.
  // Measured in headless Chromium at 1280 px: scrollWidth reached 1291 during the slide-in.
  it('stays out of the page scroll size, so it cannot flash a scrollbar', () => {
    render(
      <ToastStack anchor={null}>
        <div role="alert">Toast</div>
      </ToastStack>,
    );
    expect(stack().style.position).toBe('fixed');
  });

  // The stack is as wide as its widest toast, so the space beside a narrower toast and the gap
  // between toasts are part of its box. happy-dom applies no Tailwind CSS; in headless Chromium,
  // document.elementFromPoint there returned the stack before these classes and the page after.
  it('lets clicks beside and between its toasts through to the page', () => {
    render(
      <ToastStack anchor={null}>
        <div role="alert">Toast</div>
      </ToastStack>,
    );
    expect(stack()).toHaveClass('pointer-events-none', '[&>*]:pointer-events-auto');
  });

  // A link clicked in Conversation that cannot be followed opens its toast while Conversation
  // covers the page at z-50. The stack's portal comes after the app's root in the document, so
  // at the same z-index it paints above it; at z-40 the toast closed unseen under the panel.
  it('floats above Conversation and the other full-page panels', () => {
    render(
      <ToastStack anchor={null}>
        <div role="alert">Toast</div>
      </ToastStack>,
    );
    expect(stack()).toHaveClass('z-50');
  });

  // A review switch remounts the verdict buttons. Floating UI's `elements.reference` keeps the
  // first element it was given, so the stack stayed with the removed buttons, which measure as a
  // zero box, and its toasts sat in the window's top-left corner.
  it('moves to a new anchor after the old one is removed', async () => {
    const first = placedAnchor(new DOMRect(500, 100, 200, 40));
    const { rerender } = render(
      <ToastStack anchor={first}>
        <div role="alert">Toast</div>
      </ToastStack>,
    );
    await waitFor(() => expect(stack().style.transform).not.toBe('translate(0px, 0px)'));
    const before = stack().style.transform;

    first.remove();
    const second = placedAnchor(new DOMRect(300, 200, 200, 40));
    rerender(
      <ToastStack anchor={second}>
        <div role="alert">Toast</div>
      </ToastStack>,
    );
    await waitFor(() => expect(stack().style.transform).not.toBe(before));
    expect(stack().style.transform).not.toBe('translate(0px, 0px)');
  });

  // Dismissing the verdict toast moves the unsaved-changes toast up by the verdict toast's height;
  // it slides there instead of jumping.
  it('slides a toast up from its last place when the toast above it closes', () => {
    const tops = new Map<string, number>([
      ['above', 0],
      ['below', 100],
    ]);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return tops.get(this.dataset.name ?? '') ?? 0;
    });
    const animate = vi.spyOn(Element.prototype, 'animate');
    const { rerender } = render(
      <ToastStack anchor={null}>
        <div key="above" data-name="above" />
        <div key="below" data-name="below" />
      </ToastStack>,
    );
    expect(animate).not.toHaveBeenCalled();

    tops.set('below', 0);
    rerender(
      <ToastStack anchor={null}>
        <div key="below" data-name="below" />
      </ToastStack>,
    );
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: 'translateY(100px)' },
      { transform: 'none' },
    ]);
  });

  it('does not slide a toast that has just opened', () => {
    const animate = vi.spyOn(Element.prototype, 'animate');
    const { rerender } = render(<ToastStack anchor={null}>{null}</ToastStack>);
    act(() =>
      rerender(
        <ToastStack anchor={null}>
          <div />
        </ToastStack>,
      ),
    );
    expect(animate).not.toHaveBeenCalled();
  });
});
