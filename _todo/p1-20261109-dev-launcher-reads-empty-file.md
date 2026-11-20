---
title: Stop dev-launcher.test.ts from reading the fixture's file before it is written
priority: p1
section: Tests
---

# dev-launcher test reads an empty file

`dev/dev-launcher.test.ts` failed once in four full-suite runs with `SyntaxError: Unexpected end of JSON input` in its "opens the named review and capability without putting either in the proxy target" test. The fixture child's `writeFileSync('vite-env', …)` creates the file before writing its contents, and `waitForFile` waits only until the file exists, so the test can read it while it is still empty. Waiting until the content parses, or having the fixture write to a temporary name and rename it, would close the race.

Context: a reviewer of the browser-tab WebSocket change hit this on 2026-11-09; that change does not touch `dev/`.
