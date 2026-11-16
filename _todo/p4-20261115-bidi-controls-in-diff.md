---
title: Bidi control characters make the diff show different code from the patch
priority: p4
section: Diff rendering
---

# Bidi control characters make the diff show different code from the patch

Placeholder. Not started.

Patch text containing Unicode bidi controls (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F,
U+061C) renders reordered, the "Trojan Source" class (CVE-2021-42574). Prism tokens are React
text spans (`src/client/components/PrismSyntaxHighlighter.tsx`,
`src/client/components/EnhancedPrismSyntaxHighlighter.tsx`), and nothing in `src/client` marks
these characters.

Repro: commit a line `if (accessLevel != "user‮ ⁦// Check if admin⁩ ⁦") {` and open the
review in Chrome. The diff shows `if (accessLevel != "user") { // Check if admin`, while the
committed condition is true for every caller. File names go through the same text rendering,
so `x‮gnp.js` displays as `xsj.png`; comment bodies and Markdown previews are likely affected
the same way (not run).

Fix direction: render each of these characters as a visible marker (for example a span
reading `<U+202E>`) in the code token renderer and in file-name and comment text, and consider
a per-file warning like GitHub's. The authors who can exploit this are PR contributors under
`--pr` and a prompt-injected agent.
