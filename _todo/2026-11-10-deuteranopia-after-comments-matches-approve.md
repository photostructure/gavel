---
title: Give Approve after comments a color deuteranopes can tell from Approve
section: Accessibility
---

# Give Approve after comments a color deuteranopes can tell from Approve

Placeholder; no replacement color has been chosen.

In deuteranopia mode, `src/client/utils/appearanceTheme.ts` colors Approve
(`--color-github-accent`) blue (`#58a6ff` dark, `#0969da` light) and Approve
after comments (`--color-verdict-after-comments`) violet (`#a371f7` dark,
`#8250df` light). Under a simulated full deuteranopia (the Machado 2009 matrix
in linear RGB), the two measure 0.06 apart on dark and 0.02 on light in OKLab,
where 0 is identical. Not yet's orange measures 0.29 or more from both. So in the
mode built for these users, the two approvals' button fills, tab top borders, and
All reviews segments look nearly the same; only their icons (check mark versus
comment bubble) differ. Not checked with a colour-blind viewer.

The violet was chosen because yellow measured too close to this mode's orange
Not yet (1.60:1 dark, 1.57:1 light). A fix needs a third hue that is distinct
from both blue and orange after simulation. If Not yet becomes Reject
(`_done/2026-11-10-reject-verdict.md`) and changes color, recheck all three
together.
