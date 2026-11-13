---
title: Find why a DiffChunk range-comment test failed once
section: Tests
---

# Find why a DiffChunk range-comment test failed once

Placeholder; the cause is unknown and the test is not proven flaky.

`src/client/components/DiffChunk.test.tsx`, "DiffChunk range comments > keeps
exact unified old-side snapshots across hidden whitespace rows" (`it.each`, with
a `waitFor`), failed once in a full-suite run on a clean `git archive` export of
HEAD plus a change that did not touch `DiffChunk`. The error text was not kept.

It did not fail in 16 later full-suite runs, or in 12 runs of that file with the
`App` tests under parallel load. Reproduce it under heavier load, record the
error, and fix the test or the code it found.
