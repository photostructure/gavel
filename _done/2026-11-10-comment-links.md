---
title: Links in comment bodies that jump to comments, lines, and other named reviews
section: Comments
---

# Links in comment bodies that jump to comments, lines, and other named reviews

Matthew asked for links in comments to other comments, other parts of the code, and
other reviews on a multi-review server, so an agent can write a non-linear reading
tour. Comment bodies already rendered Markdown, but a `#…` link only changed the page
hash. Gavel now follows these links in place; see
[links in comments](../docs/cli.md#links-in-comments).

- [x] `#thread=<id>`, `#file=<path>[&line=N|N-M][&side=old|new]`, and
      `?review=<name>[#…]` parse, and malformed ones report why —
      `./node_modules/.bin/vitest run src/client/utils/commentLinks.test.ts`
- [x] Following a link jumps to the thread, file, or line, switches review first when
      the link names another one, pushes a history entry that Back returns from, and
      shows a notice for a missing thread, file, review, or unshowable line without
      touching history — `./node_modules/.bin/vitest run src/client/hooks/useCommentLinks.test.ts src/client/App.commentLinks.test.tsx`
- [x] Back within a review changes only the place and does not reload the review or
      pin a Git comparison to its launch commits; a review switch by tab or picker drops
      the old review's place from the URL —
      `./node_modules/.bin/vitest run src/client/utils/reviewNavigation.test.ts src/client/App.commentLinks.test.tsx`
- [x] Links in another review's comment, shown in Conversation, point into that review,
      in both the click and the rendered href —
      `./node_modules/.bin/vitest run src/client/components/CommentBodyRenderer.test.tsx`
- [x] A linked line in hidden context opens that context —
      `./node_modules/.bin/vitest run src/client/components/DiffViewer.test.tsx`
- [x] Both gavel skills tell agents to link reading-guide comments into a tour

## Decisions

- Plain relative URLs rather than a `#gavel:` fragment grammar, because the query
  already names the review (`?review=`) and a fragment-only grammar re-implements
  hash-bang routing (Matthew raised it; option A of 90-5 accepted as recommended).
- Each jump pushes a browser history entry, so Back returns to the comment the link
  was in (Matthew, 90-3). A link in another review's comment leaves the current entry
  as it was, since the open review lacks that thread; Back returns to that review.
- A destination gavel cannot follow shows a notice when clicked (Matthew, 90-2, who
  suggested an alert or toast over muted rendering). Gavel has no toast component, so
  it is a dismissible `role="status"` bar at the bottom of the page.
- Built in the session that proposed it (Matthew, 90-4).
- A line number that is not a safe integer is a malformed link, so `line=1-` with 400
  nines no longer expands every hidden gap in a file; a large finite range still does,
  as **Expand all lines** does (Codex security review; 90-9 A accepted as recommended).
- Remote images in comments and in **Why this change** load when shown: the agent that
  writes them is trusted (Matthew, 90-10).
- A jump to a comment scrolls its card to the top third of the screen when the card is not
  fully visible, since showing its line can leave the comment below the fold (Matthew asked
  after click-testing).
- Link jumps to a line or comment scroll smoothly so the reader sees the view move, and jump
  instantly when the system asks for reduced motion (Matthew asked for smooth scrolling). A
  jump to a comment makes one scroll, to its card: a scroll to its line first would still be
  moving when the card was measured. Jumps to a file's header, and every jump into a file that
  has not rendered yet (on load gavel renders the first 8 files), stay instant: files render
  as the view reaches them and that scroll corrects itself afterwards (90-12 A and 90-13 A
  accepted as recommended). Keyboard
  navigation and the drafts' "Go to line" still jump.
- The comment a link leads to glows blue at once, holds while the view scrolls, throbs once
  when the scroll ends, and fades, so the reader sees where they landed even when the jump
  did not scroll or did not animate. The throb changes only the glow, never the card's
  position; with reduced motion the ring shows and goes without animating (Matthew suggested
  the glow, asked that it outlast the scroll, and asked for the throb; 90-14 A accepted as
  recommended).
- Clicking a link in an agent's comment marks that comment read, as a click on its text does;
  another review's comments in Conversation keep their read state until their read controls
  are used (Matthew: a link is clicked only after the comment was read).

## Lore

- Link errors reach the reader, who did not write the link, so they start with
  "Can't follow this link:" and describe the link, not the grammar.
- A fragment is a link place only when it contains `=` and one of `thread`, `file`,
  `line`, or `side`; then any other key except `gavel-editor-token` is an error. Other
  fragments, such as `#summary`, stay ordinary anchors.
- The launch URL carries `#gavel-editor-token=…` (`EDITOR_SESSION_FRAGMENT_KEY`).
  Rewriting the fragment keeps that key, or open-in-editor fails after a reload. A
  modified click on a link opens a URL without it.
- `writeReviewLocation` runs after every diff load, so it drops a link's place only
  when the query changes.
- Because each jump pushes a history entry, a tab where the reader followed a link
  can no longer close itself after the last verdict (browsers refuse `window.close()`
  once a tab has history); the follow-up notice then says the tab can be closed.
- A named review's capture holds only its hunks, so a link to another line reports a
  notice. A line past the end of an expandable file is not detected: the jump waits at
  the file's top until the next click, like a draft's "Go to line".
- The cursor lands on the last line of a range, where a comment on that range shows.

## Review

- [x] Reviewed — LAND from Claude on every batch, including the click-test fixes; Codex slot skipped (front-end change, Matthew's standing instruction); base commit `d2a6638`
