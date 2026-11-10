---
title: Stop dev-launcher.test.ts from reading the fixture's file before it is written
section: Tests
---

# dev-launcher test reads an empty file

`dev/dev-launcher.test.ts` failed once in four full-suite runs with `SyntaxError: Unexpected end of JSON input` at line 279. The fixture child's `writeFileSync('vite-env', …)` (line 84) creates the file before writing its contents, and `waitForFile` (lines 26-37) waits only until the file exists, so the test can read it while it is still empty. Waiting until the content parses, or having the fixture write to a temporary name and rename it, would close the race.

Context: a reviewer of the browser-tab WebSocket change hit this on 2026-11-09; that change does not touch `dev/`.
