---
title: Small defects found by the 2026-11-14 refactor audit
priority: p2
section: Web UI
---

# TPP: Small defects from the refactor audit

One- or two-line fixes, each its own commit. Line numbers at `d905dec`.

- **Disabled buttons show a pointer cursor.** `button { cursor: pointer; }`
  (global.css:236-238) is unlayered, so it beats every `disabled:cursor-not-allowed`
  utility in `@layer utilities`. `CommentThreadCard.tsx:557` works around it with
  `disabled:cursor-default!`. Fix: wrap the rule in `@layer base`, then drop only the
  `!` from that utility (keep `disabled:cursor-default`: it is the deleted-thread
  collapse button's only disabled cursor rule, and without it the button shows a
  pointer again; checked in headless Chromium during review of this plan). Check in
  headless Chromium; happy-dom does not resolve layers.
- **Copied-state timers are never cleared** (DiffViewerHeader.tsx:141, App.tsx:1864): a
  second click within 2 s is reset early by the first timer, and the timer fires after
  unmount. `p3-20261114-client-shared-ui.md` task 3 replaces both with one hook;
  fix there if that lands first.
- **`ImageDiffViewer.tsx:64` never checks `response.ok`.**
- **Three settings controls have no accessible name.** The `<label>`s at
  SettingsModal.tsx:346, 367, 435 are not associated with the font-size slider and two
  selects.
- **Wrong or stale comments:**
  - App.tsx:1432 "Lock files are now automatically marked as viewed by useViewedFiles
    hook" has no code under it (upstream a1e9679).
  - server.ts:1510 calls progress "process-local", but conversation.ts:129 restores it
    from the saved record. (Its "never … overwritten by browser payloads" part is
    true.)
  - The item-number comments from an upstream difit PR: "(#2)" at useExpandedLines.ts:138,
    140; "(#8)" at ExpandButton.tsx:20; "(#6)" and "(#10)" at SideBySideDiffChunk.tsx:99, 104.
  - StorageService.ts:23 says "filesystem-safe"; the key is a localStorage key.
  - The "older server" wording around an undefined `delivery` (App.tsx:2557-2559,
    AgentDeliveryStatus.tsx:309): the case is a server
    without conversations, not an older build.
- **Misleading name.** `resolveEventSourceUrl` (client/utils/eventSourceUrl.ts:1) builds
  WebSocket and fetch URLs; nothing uses EventSource.
- **`console.log('✅ …')` in production code** (App.tsx:1730); App.test.tsx:877 asserts
  the text. `p1-20261114-split-app-tsx.md` moves the `--clean` code (1724-1734) into
  `useViewedFiles`; fix it before or in its own commit, not inside that move.
