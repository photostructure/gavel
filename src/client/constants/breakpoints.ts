const BREAKPOINTS = {
  mobileMax: 767,
  desktopMin: 1024,
  shortMax: 500,
} as const;

export const MEDIA_QUERIES = {
  mobile: `(max-width: ${BREAKPOINTS.mobileMax}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktopMin}px)`,
  // A phone or tablet in either orientation, or a window as short as a landscape phone.
  // Keep in sync with the `auto-hide-header` variant in styles/global.css.
  autoHideHeader: `(pointer: coarse), (max-height: ${BREAKPOINTS.shortMax}px)`,
} as const;
