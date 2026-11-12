import { useCallback } from 'react';

// What the review header gives room to, highest priority first: the Approve and Reject buttons
// (otherwise a menu), the logo, the review name on the revision picker, and the Settings, About
// and Conversation labels. Each is a data attribute on the header that its controls'
// group-data classes read.
const STEPS = [
  'data-verdict-menu',
  'data-hide-logo',
  'data-hide-review-name',
  'data-hide-labels',
] as const;

// The header's controls: not its full-width alert rows or screen-reader-only text.
function rowItems(header: HTMLElement): HTMLElement[] {
  return [...header.children].filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el.offsetWidth > 0 &&
      !el.classList.contains('w-full') &&
      getComputedStyle(el).position !== 'absolute',
  );
}

// Only the logo claims room in the logo box; text beside it, such as "Updating capture…",
// clips instead of outranking the verdict buttons.
function fits(header: HTMLElement, logoBox: HTMLElement, logo: HTMLElement): boolean {
  const [first, ...rest] = rowItems(header);
  return (
    rest.every((el) => el.offsetTop === first?.offsetTop) &&
    (header.hasAttribute('data-hide-logo') || logo.offsetWidth <= logoBox.clientWidth)
  );
}

/**
 * Starts from the narrowest header and, in priority order, gives each item its room if the
 * controls still fit on one row with the logo box wide enough for the logo. An item that does not
 * fit leaves its room to the ones after it. When even the narrowest header needs a second row, it
 * wraps.
 */
export function fitHeader(header: HTMLElement, logoBox: HTMLElement, logo: HTMLElement): void {
  for (const step of STEPS) header.setAttribute(step, '');
  if (!fits(header, logoBox, logo)) return;
  for (const step of STEPS) {
    header.removeAttribute(step);
    if (!fits(header, logoBox, logo)) header.setAttribute(step, '');
  }
}

/**
 * A ref for the review header that refits it whenever its content changes (synchronously, before
 * paint) or its width or a control's width changes (on the next frame, which also catches web
 * fonts loading). The header must hold a [data-header-logo-box] that grows into the space left
 * over, with the [data-header-logo] inside it.
 */
export function useHeaderFit() {
  return useCallback((header: HTMLElement | null) => {
    if (!header) return;
    const logoBox = header.querySelector<HTMLElement>('[data-header-logo-box]');
    const logo = logoBox?.querySelector<HTMLElement>('[data-header-logo]');
    if (!logoBox || !logo) {
      throw new Error('useHeaderFit: the header has no [data-header-logo-box] [data-header-logo]');
    }
    const fit = () => fitHeader(header, logoBox, logo);

    // Refitting inside the ResizeObserver callback would resize what it observes, which browsers
    // report as a ResizeObserver loop; the next frame settles because the result repeats.
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    const observeRow = () => {
      resize.disconnect();
      resize.observe(header);
      for (const child of header.children) resize.observe(child);
    };
    // The header's own data attributes are not in the filter, so fitting does not refit.
    const mutations = new MutationObserver((records) => {
      // Re-observing makes the ResizeObserver report every element again, so do it only when
      // the header's own children change.
      if (records.some((record) => record.type === 'childList' && record.target === header)) {
        observeRow();
      }
      fit();
    });
    mutations.observe(header, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    observeRow();
    fit();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);
}
