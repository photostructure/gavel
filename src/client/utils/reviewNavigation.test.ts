import { beforeEach, describe, expect, it } from 'vitest';

import {
  readReviewHistoryLocation,
  readReviewLocation,
  writeLocationHash,
  writeReviewLocation,
} from './reviewNavigation';

describe('review browser locations', () => {
  beforeEach(() =>
    window.history.replaceState({ kept: true }, '', '/?theme=dark#editor-session=token'),
  );

  it('loads a named review without requiring or trusting revision parameters', () => {
    window.history.replaceState(null, '', '/?review=task-a&base=wrong&target=wrong&baseMode=bad');
    expect(readReviewLocation()).toEqual({
      baseCommitish: '',
      targetCommitish: '',
      reviewName: 'task-a',
    });
  });

  it.each(['bad name', ''])(
    'preserves explicit name %j for server validation instead of showing another review',
    (reviewName) => {
      window.history.replaceState(null, '', `/?review=${encodeURIComponent(reviewName)}`);
      expect(readReviewLocation()?.reviewName).toBe(reviewName);
    },
  );

  it('keeps named history stable across capture base changes while preserving unrelated state', () => {
    writeReviewLocation(
      { baseCommitish: 'old-base', targetCommitish: '.', reviewName: 'task-a', retained: true },
      'replace',
    );
    expect(window.location.search).toBe('?theme=dark&review=task-a');
    expect(window.location.hash).toBe('#editor-session=token');
    expect(window.history.state).toEqual({ kept: true });
    const first = window.location.href;
    writeReviewLocation(
      { baseCommitish: 'new-base', targetCommitish: '.', reviewName: 'task-a' },
      'replace',
    );
    expect(window.location.href).toBe(first);
  });

  it('removes named scope when navigating to an ordinary Git comparison', () => {
    writeReviewLocation(
      { baseCommitish: 'base', targetCommitish: '.', reviewName: 'task-a' },
      'replace',
    );
    writeReviewLocation(
      { baseCommitish: 'main', targetCommitish: '.', baseMode: 'merge-base', retained: true },
      'push',
    );
    expect(new URLSearchParams(window.location.search).has('review')).toBe(false);
    expect(readReviewLocation()).toEqual({
      baseCommitish: 'main',
      targetCommitish: '.',
      baseMode: 'merge-base',
      retained: true,
    });
  });

  it('keeps the resolved review of an entry whose fragment a comment link rewrites', () => {
    window.history.replaceState(null, '', '/?base=HEAD&target=.');
    writeReviewLocation({ baseCommitish: 'HEAD', targetCommitish: '.' }, 'replace', {
      baseCommitish: 'abc123',
      targetCommitish: '.',
    });
    writeLocationHash('#thread=t1', 'replace');
    writeLocationHash('#thread=t2', 'push');
    expect(window.location.hash).toBe('#thread=t2');
    expect(readReviewHistoryLocation()).toEqual({
      baseCommitish: 'abc123',
      targetCommitish: '.',
      retained: true,
    });
  });

  it("drops a comment link's place when the review changes, and keeps it otherwise", () => {
    window.history.replaceState(null, '', '/?review=a#gavel-editor-token=k&thread=t2');
    writeReviewLocation({ baseCommitish: '', targetCommitish: '', reviewName: 'a' }, 'replace');
    expect(window.location.hash).toBe('#gavel-editor-token=k&thread=t2');
    writeReviewLocation({ baseCommitish: '', targetCommitish: '', reviewName: 'b' }, 'replace');
    expect(window.location.search).toBe('?review=b');
    expect(window.location.hash).toBe('#gavel-editor-token=k');
  });
});
