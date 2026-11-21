# The `--why` summary

Write `--why` (or the `rationale` of `comment summary`) as a summary of at most
200 words for a reader who hasn't followed your session; the review page shows
it beside the commit message. Name each subject the way the user meets it (the
page, setting, command, or test) and give concrete values. Write short
paragraphs that start with these bold labels, with no headings or nested lists:

1. **Problem**: what was wrong or missing, and how it showed up.
2. **Change**: what the diff does about it.
3. **Alternatives**: the smaller or different fixes that were possible, and why
   each falls short.

Then add one line each for **Tests** (what ran, on which commit or capture, and
the result) and **Review** (the independent reviews of this code and their
verdicts, or "none"). Leave out the diffstat and the commit body. End with the
tour's first link when the review has a tour.
