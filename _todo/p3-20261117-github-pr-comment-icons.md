---
title: Give comments imported from a GitHub PR their own author icons
priority: p3
section: Review UI
---

# GitHub PR comment icons

`gavel --pr <url>` imports a PR's unresolved inline review threads as comments.
Every import is marked as coming from the agent (`origin: 'agent'`), so each one
shows the robot, with the GitHub login only in its tooltip. Only a comment whose
author's account was deleted (author `ghost`) shows its own icon, lucide
`HatGlasses`, labelled "Deleted GitHub account".

Matthew's ideas (2026-11-17), not yet decided:

- The PR's author gets lucide `git-pull-request-arrow`.
- A comment whose GitHub login is the reviewer's own keeps the person icon.
- Other reviewers get an icon and a colour picked from different bits of a hash of
  their login, so each looks the same on every load: about a dozen lucide animals
  (cat, dog, bird, fish, rabbit, squirrel, turtle, snail, rat, bug…), which stay
  distinct at 16px, times about ten colours. With 12 icons and 10 colours, two
  reviewers on one PR match about 0.8% of the time and four about 5%. The colours
  must avoid gavel's meaningful ones (danger red, Approve green, Reject purple,
  comment yellow) and reach 3:1 against the card in both themes.

This needs data gavel does not keep: imports must record that they came from
GitHub, gavel must fetch the PR's author, and it must learn the reviewer's GitHub
login (for example from `gh api user`). Matthew does not use `--pr` today, so
there is no play-test for it yet.
