---
title: Stack the unsaved-changes toast under the verdict toast in one positioned stack
section: Web UI
---

# TPP: Unsaved-changes toast stack

## Summary

The orange unsaved-changes toast ([UnsavedChangesToast.tsx](../src/client/components/UnsavedChangesToast.tsx)) used to float through Floating UI on its own anchor: the blue verdict toast while that was open, otherwise the verdict buttons or the header. Each of the three defects found in play testing came from that anchoring:

1. In Firefox the toast moved along an arc when the verdict toast was dismissed.
2. It sat 3 px off the verdict buttons' right edge.
3. After **Switch to <review>** it was stuck in the window's top-left corner.

Now both header toasts are children of one [ToastStack](../src/client/components/ToastStack.tsx). Only the stack is positioned, under the verdict buttons; layout puts the orange toast under the blue one, and a FLIP slides it straight up when the blue one closes.

## Current phase

Complete. The toast stack landed on `fix/toast-and-robot`.

- [x] Diagnosis of the top-left toast (see Lore)
- [x] Failing test: `App.namedReviews.test.tsx` "stacks the unsaved-changes toast under the verdict toast after a review switch"; `ToastStack.test.tsx` "moves to a new anchor after the old one is removed" fails with `elements.reference`
- [x] Implementation (Option A)
- [x] Headless check in Chromium and Firefox (Tasks 2)
- [x] Reviewed: Claude reviewer LAND on pass 2, on base 2d5b6c3; the Codex slot is missing (front-end batch)
- [x] Maintainer play test passed and gavel Approve given

## Lore

- `@floating-ui/react` 0.27 `useFloatingRootContext` does `const [positionReference] = useState(elementsProp.reference)` and positions against `positionReference || elementsProp.reference`. A `useFloating` that mounts with a non-null `elements.reference` keeps that element for the rest of its life. `ToastStack` therefore passes its anchor through `refs.setReference` in a layout effect, which follows a new anchor. `@floating-ui/react-dom`, whose `useFloating` follows `elements.reference`, is not a direct dependency, so pnpm will not resolve it from `src`.
- The top-left toast, reproduced headlessly in Chromium and Firefox: on toast-b click **Approve**; click **Switch to toast-a** and **Approve**; stop the server; comment on a diff line and click **Send**. The old toast's hook state then held toast-b's detached verdict toast while its `anchor` prop was toast-a's connected one, and the `isConnected` guard skipped every update. It was not confirmed which ancestor remounts the toast on a review switch.
- A detached element measures as a zero box at the window's corner. The verdict buttons are the stack's anchor because they stay mounted while toasts open and close; a review switch remounts them through a callback ref, which `refs.setReference` follows.
- The header's right edge is 3 px right of the verdict buttons' right edge, so anchoring to the header drifted.
- The slide measures `offsetTop`, which leaves out the slide's own transform; `getBoundingClientRect` would let a render during a slide start a second slide from the middle of the first. The stack's ref callback must be stable: a new callback each render runs again in every commit and records the new places before the layout effect compares them.
- `FloatingPortal` mounts the stack's children in its own render, after `ToastStack`'s first layout effect, so the first places are recorded when the stack element attaches.
- The stack is as wide as its widest toast. `pointer-events-none` on the stack and `pointer-events-auto` on each toast let clicks beside a narrower toast and in the gap reach the page.
- Tailwind `transition-*` classes on a toast lose to an unlayered theme rule (`[class*=text-github]`), which is why the slide uses the Web Animations API instead of a CSS transition. The verdict toast's entry animation uses `translate`, not `transform`, so it never fights the slide.
- On touch screens, or screens 500 px tall or shorter, the header group collapses inside an `overflow-hidden` wrapper. The stack lives in a portal so the wrapper cannot clip it, and its `hide()` middleware hides both toasts while the header is away, as before.
- Headless replays of toast placement must include a review switch (**Switch to** the other review, then a verdict there). The single-review flows passed while the switch flow put the toast in the corner.
- Two rounds of patches to the anchor chain (an `isConnected` guard, then anchoring to the verdict buttons) each fixed one symptom; the design was the problem. AGENTS.md's rule about a third patch applies.
- happy-dom computes no layout and applies no Tailwind CSS. Vitest pins structure and class names; positions and hit testing are checked with a headless Playwright replay.

## Solutions

### Option A (built): one positioned stack

`ToastStack` renders a `FloatingPortal` holding one fixed flex column, positioned `bottom-end` of the verdict buttons (or the header on pages without them) with `offset(6)`, `shift({ padding: 8 })` and `hide()`. App puts `VerdictFollowUpNotice` first and `UnsavedChangesToast` second inside it. Neither toast positions itself; the verdict toast keeps `useFloating` only for `FloatingFocusManager`'s context, with `elements.reference` set to the verdict buttons for tab order. App's `verdictToast` state, `onElement`, the unsaved toast's `anchor` prop, the `isConnected` guard and the `data-glide` CSS are gone.

### Option B (rejected): follow anchor changes in the old design

Switch `UnsavedChangesToast` to an API that follows its anchor. It is the smallest diff, but it keeps the anchor chain from one toast to another that produced all three defects.

### Option C (rejected): a toast library such as sonner

Its toasts sit in a screen corner and own their DOM, while the verdict toast needs its own focus handling and buttons under the verdict controls.

## Tasks

1. Unit and App tests: `./node_modules/.bin/vitest run`, `pnpm check`, `pnpm format`.
2. Headless replay in Chromium and Firefox of three flows: the review switch from Lore; Approve, then stop the server and comment; stop the server and comment with no verdict. Pass when the orange toast's right edge equals the verdict buttons' right edge and its top is 6 px under the blue toast (or the buttons), and when, after the blue toast is dismissed, only its y changes on every frame until it stops 6 px under the buttons. Pass also when `document.elementFromPoint` left of the blue toast and in the gap returns the page, not the stack.
3. Maintainer play test in a private window: the review-switch steps from Lore, then dismiss the blue toast.
