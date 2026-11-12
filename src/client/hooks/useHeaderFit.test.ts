import { describe, expect, it } from 'vitest';

import { fitHeader } from './useHeaderFit';

// happy-dom has no layout, so each test lays the header out from a width model: every control
// needs a fixed width, and anything past the header's width wraps to a second row.
function layOut({
  width: initialWidth,
  alert = false,
  status = 0,
}: {
  width: number;
  alert?: boolean;
  // The width of text beside the logo, such as "Updating capture…".
  status?: number;
}) {
  let width = initialWidth;
  const header = document.createElement('header');
  const make = (name: string) => {
    const el = document.createElement('div');
    el.dataset.name = name;
    header.append(el);
    return el;
  };
  const toggle = make('toggle');
  const box = make('logo-box');
  box.dataset.headerLogoBox = '';
  const logoEl = document.createElement('h1');
  box.append(logoEl);
  const picker = make('picker');
  const settings = make('settings');
  const verdict = make('verdict');
  if (alert) make('alert').className = 'w-full';

  const has = (step: string) => header.hasAttribute(step);
  const widths = (): Record<string, number> => ({
    toggle: 40,
    picker: has('data-hide-review-name') ? 50 : 200,
    settings: has('data-hide-labels') ? 50 : 100,
    verdict: has('data-verdict-menu') ? 50 : 180,
  });
  // A hidden logo is sr-only: absolutely positioned and 1 px wide.
  const logo = () => (has('data-hide-logo') ? 1 : 80);
  const rowWidth = () => Object.values(widths()).reduce((sum, w) => sum + w, 0);
  const define = (el: HTMLElement, props: Record<string, () => number>) => {
    for (const [key, get] of Object.entries(props)) Object.defineProperty(el, key, { get });
  };
  for (const el of [toggle, picker, settings, verdict]) {
    const name = el.dataset.name ?? '';
    define(el, {
      offsetWidth: () => widths()[name] ?? 0,
      // The verdict control is last, so it is what wraps first.
      offsetTop: () => (el === verdict && rowWidth() > width ? 40 : 0),
    });
  }
  define(box, {
    offsetWidth: () => Math.max(width - rowWidth(), 0),
    offsetTop: () => 0,
    clientWidth: () => Math.max(width - rowWidth(), 0),
    scrollWidth: () => logo() + status,
  });
  define(logoEl, { offsetWidth: logo });
  const alertRow = header.querySelector<HTMLElement>('[data-name=alert]');
  if (alertRow) define(alertRow, { offsetWidth: () => width, offsetTop: () => 40 });
  document.body.append(header);
  return {
    header,
    box,
    logo: logoEl,
    setWidth: (next: number) => {
      width = next;
    },
  };
}

const applied = (header: HTMLElement) =>
  ['data-hide-labels', 'data-hide-review-name', 'data-hide-logo', 'data-verdict-menu'].filter(
    (step) => header.hasAttribute(step),
  );

describe('fitHeader', () => {
  // Everything at full width needs 40 + 200 + 100 + 180 = 520 px, plus 80 for the logo.
  it.each([
    [700, []],
    [590, ['data-hide-labels']],
    [420, ['data-hide-labels', 'data-hide-review-name']],
    [350, ['data-hide-labels', 'data-hide-review-name', 'data-hide-logo']],
    [220, ['data-hide-labels', 'data-hide-review-name', 'data-hide-logo', 'data-verdict-menu']],
  ])(
    'gives room to the verdict buttons, then the logo, the review name and the labels (%i px)',
    (width, steps) => {
      const { header, box, logo } = layOut({ width });
      fitHeader(header, box, logo);
      expect(applied(header)).toEqual(steps);
    },
  );

  it('gives the logo its room back when the verdict buttons do not fit anyway', () => {
    const { header, box, logo } = layOut({ width: 300 });
    fitHeader(header, box, logo);
    expect(applied(header)).toEqual([
      'data-hide-labels',
      'data-hide-review-name',
      'data-verdict-menu',
    ]);
  });

  it('shows a narrower lower-priority item when a wider higher-priority one does not fit', () => {
    const { header, box, logo } = layOut({ width: 450 });
    fitHeader(header, box, logo);
    expect(applied(header)).toEqual(['data-hide-review-name']);
  });

  it('keeps everything hidden and lets the header wrap when even that does not fit', () => {
    const { header, box, logo } = layOut({ width: 150 });
    fitHeader(header, box, logo);
    expect(applied(header)).toHaveLength(4);
  });

  it('gives the space back when the header widens again', () => {
    const { header, box, logo, setWidth } = layOut({ width: 300 });
    fitHeader(header, box, logo);
    setWidth(700);
    fitHeader(header, box, logo);
    expect(applied(header)).toEqual([]);
  });

  // R644-A: a recapture's "Updating capture…" status collapsed the verdict buttons into the menu.
  it('leaves text beside the logo out of the fit', () => {
    const { header, box, logo } = layOut({ width: 330, status: 40 });
    fitHeader(header, box, logo);
    expect(applied(header)).toEqual([
      'data-hide-labels',
      'data-hide-review-name',
      'data-hide-logo',
    ]);
  });

  it('does not count a full-width alert row as a wrapped control', () => {
    const { header, box, logo } = layOut({ width: 700, alert: true });
    fitHeader(header, box, logo);
    expect(applied(header)).toEqual([]);
  });
});
