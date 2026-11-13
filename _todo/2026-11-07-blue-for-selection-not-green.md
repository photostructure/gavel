---
title: Use blue, not green, for selection and emphasis that is not approval
section: Appearance
---

# TPP: Use blue, not green, for selection and emphasis that is not approval

Placeholder. Not started.

Green (`--color-github-accent`, defined in `src/client/styles/global.css` and
`src/client/utils/appearanceTheme.ts`) now means approval: a chosen **Approve
as-is** is filled green and an approved review's tab mark is green
(`VerdictControl.tsx`, `ReviewQueueBar.tsx`; see
[2026-11-07-review-verdicts.md](2026-11-07-review-verdicts.md)). The same green also
marks things unrelated to approval, which the maintainer found confusing ("the green
really does cause some confusion with conflating approval with selection"), for
example the border under each file header and the selected option buttons in
**Settings**. `grep -rl github-accent src/client` lists every use.

## Direction

Add a selection color token (the maintainer suggested blue, "or some pickable theme
color"; whether it should be a **Settings** choice is still open) and move every
non-approval use of `github-accent` to it, keeping green only where it means a
recorded approval. The blue already used for the verdict notice's primary button
(**Switch to `<name>`**, first called **Switch now**; `blue-600` in
`VerdictFollowUpNotice.tsx`) is the maintainer's reference
("the blue for the switch now is nice"). Check the deuteranopia palette in
`appearanceTheme.ts`, where the accent is already blue.
