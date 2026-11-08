import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewSummary, ConversationSnapshot } from '../types/conversation.js';
import type { DiffResponse } from '../types/diff.js';
import { DiffMode } from '../types/watch.js';

import { GitDiffParser } from './git-diff.js';
import { captureWorkingTree } from './review-capture.js';
import { startServer } from './server.js';

const previousMessage = 'fix: retain café context\n\nExplain the full change.\n\nRefs: #123\n';
const currentMessage = 'feat: show committed intent\n\nKeep the complete explanation.\n';

describe('committed review summary HTTP integration', () => {
  let root: string;
  let running: Awaited<ReturnType<typeof startServer>> | undefined;

  function git(...args: string[]): string {
    return execFileSync(
      'git',
      [
        '-c',
        'user.name=gavel',
        '-c',
        'user.email=gavel@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        `core.hooksPath=${devNull}`,
        ...args,
      ],
      {
        cwd: root,
        env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
        encoding: 'utf8',
      },
    );
  }

  async function start(options: Parameters<typeof startServer>[0] = {}) {
    running = await startServer({
      repoPath: root,
      preferredPort: 0,
      openBrowser: false,
      keepAlive: true,
      conversation: true,
      diffMode: DiffMode.SPECIFIC,
      selection: { baseCommitish: 'HEAD^', targetCommitish: 'HEAD' },
      ...options,
    });
  }

  async function request<T>(path: string, body?: unknown): Promise<T> {
    if (!running) throw new Error('Fixture server has not started');
    const response = await fetch(new URL(path, running.url), {
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  }

  const summaryPath = (diff: DiffResponse) =>
    `/api/review-summary?${new URLSearchParams({
      base: diff.baseCommitish!,
      target: diff.targetCommitish!,
    })}`;

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GIT_')) vi.stubEnv(key, undefined);
    }
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gavel-committed-summary-')));
    git('init', '--quiet');
    for (const [index, message] of ['fixture root', previousMessage, currentMessage].entries()) {
      writeFileSync(join(root, 'fixture.txt'), `revision ${index}\n`);
      git('add', 'fixture.txt');
      git('commit', '--quiet', '-m', message);
    }
    writeFileSync(join(root, 'fixture.txt'), 'working draft\n');
  });

  afterEach(async () => {
    await running?.shutdown('closed');
    running = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('seeds the initial committed comparison with its actual full target message', async () => {
    await start();
    const diff = await request<DiffResponse>('/api/diff');
    const summary = await request<ReviewSummary>(summaryPath(diff));
    const snapshot = await request<ConversationSnapshot>('/api/conversation/snapshot');

    expect(diff.targetCommitMessage).toBe(currentMessage);
    expect(summary).toMatchObject({ commitMessage: currentMessage, rationale: '', version: 1 });
    expect(snapshot.reviews).toHaveLength(1);
    expect(snapshot.reviews[0]?.summary).toEqual(summary);
    expect(snapshot.reviews[0]?.selection.targetCommitish).toBe(diff.targetCommitish);
  });

  it('seeds selected commits independently and preserves saved edits and deliberate clears on refresh', async () => {
    git('config', 'i18n.logOutputEncoding', 'ISO-8859-1');
    await start({
      selection: { baseCommitish: 'HEAD', targetCommitish: '.' },
      commitMessage: 'feat: my working proposal',
      why: 'Keep the draft for the uncommitted review.',
    });
    const proposal = await request<DiffResponse>('/api/diff');
    const proposalSummary = await request<ReviewSummary>(summaryPath(proposal));
    expect(proposal.targetCommitMessage).toBeUndefined();

    const current = await request<DiffResponse>('/api/diff?base=HEAD%5E&target=HEAD');
    const currentPath = summaryPath(current);
    const initial = await request<ReviewSummary>(currentPath);
    expect(initial.commitMessage).toBe(currentMessage);
    const saved = await request<ReviewSummary>(currentPath, {
      commitMessage: 'My saved explanation\n\nKeep this instead of the Git default.',
      rationale: 'User notes for this comparison.',
      baseVersion: initial.version,
    });
    const originalSnapshot = await request<ConversationSnapshot>('/api/conversation/snapshot');
    const originalReview = originalSnapshot.reviews.find(
      (review) => review.selection.targetCommitish === current.targetCommitish,
    );

    const previous = await request<DiffResponse>('/api/diff?base=HEAD%5E%5E&target=HEAD%5E');
    expect(previous.targetCommitMessage).toBe(previousMessage);
    expect(await request<ReviewSummary>(summaryPath(previous))).toMatchObject({
      commitMessage: previousMessage,
      rationale: '',
      version: 1,
    });

    await request('/api/diff?base=HEAD%5E&target=HEAD');
    expect(await request(currentPath)).toEqual(saved);
    const cleared = await request<ReviewSummary>(currentPath, {
      commitMessage: '',
      rationale: '',
      baseVersion: saved.version,
    });
    await request('/api/diff?base=HEAD%5E&target=HEAD');
    expect(await request(currentPath)).toEqual(cleared);
    await request('/api/diff?base=HEAD&target=.');
    expect(await request(summaryPath(proposal))).toEqual(proposalSummary);
    const snapshot = await request<ConversationSnapshot>('/api/conversation/snapshot');
    expect(snapshot.reviews.find((review) => review.id === originalReview?.id)?.summary).toEqual(
      cleared,
    );
    expect(snapshot.reviews).toHaveLength(3);
  });

  it('marks a message copied from the commit until someone saves the summary', async () => {
    await start();
    const diff = await request<DiffResponse>('/api/diff');
    const copied = await request<ReviewSummary>(summaryPath(diff));
    expect(copied).toMatchObject({ commitMessage: currentMessage, fromCommit: true });
    const snapshot = await request<ConversationSnapshot>('/api/conversation/snapshot');
    expect(snapshot.reviews[0]?.summary.fromCommit).toBe(true);

    // Saving the copied text unchanged adopts it as a proposal, so it drops the mark too.
    const adopted = await request<ReviewSummary>(summaryPath(diff), {
      commitMessage: currentMessage,
      rationale: '',
      baseVersion: copied.version,
    });
    expect(adopted).toMatchObject({ commitMessage: currentMessage, version: copied.version + 1 });
    expect(adopted.fromCommit).toBeUndefined();
    const after = await request<ConversationSnapshot>('/api/conversation/snapshot');
    expect(after.reviews[0]?.summary.fromCommit).toBeUndefined();

    // Once it is a proposal, an unchanged save is a no-op again.
    expect(
      await request<ReviewSummary>(summaryPath(diff), {
        commitMessage: currentMessage,
        rationale: '',
        baseVersion: adopted.version,
      }),
    ).toEqual(adopted);
  });

  it('reads the commit message rather than an annotated tag description', async () => {
    git('tag', '-a', '-m', 'Tag annotation is not the commit message', 'review-tag');
    await start({ selection: { baseCommitish: 'HEAD^', targetCommitish: 'review-tag' } });
    const diff = await request<DiffResponse>('/api/diff');
    expect(diff.targetCommitMessage).toBe(currentMessage);
    expect(await request<ReviewSummary>(summaryPath(diff))).toMatchObject({
      commitMessage: currentMessage,
    });
  });

  it('keeps an explicit initial summary instead of replacing it with Git metadata', async () => {
    await start({ commitMessage: 'My explicit review draft', why: 'Keep the supplied rationale.' });
    const diff = await request<DiffResponse>('/api/diff');
    expect(diff.targetCommitMessage).toBe(currentMessage);
    const summary = await request<ReviewSummary>(summaryPath(diff));
    expect(summary).toMatchObject({
      commitMessage: 'My explicit review draft',
      rationale: 'Keep the supplied rationale.',
      version: 1,
    });
    expect(summary.fromCommit).toBeUndefined();
  });

  it('keeps the launch summary when HEAD moves twice while the first move is handled', async () => {
    git('add', 'fixture.txt');
    await start({
      diffMode: DiffMode.STAGED,
      selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
      commitMessage: 'feat: stage the draft',
      why: 'Keep the staged proposal.',
    });
    await request<DiffResponse>('/api/diff');

    // The watcher clears the resolved-commit cache once it sees each commit.
    const clear = GitDiffParser.prototype.clearResolvedCommitCache;
    let cleared = () => {};
    vi.spyOn(GitDiffParser.prototype, 'clearResolvedCommitCache').mockImplementation(function (
      this: GitDiffParser,
    ) {
      clear.call(this);
      cleared();
    });
    const moveHead = async (path: string) => {
      writeFileSync(join(root, path), `${path}\n`);
      git('add', path);
      git('commit', '--quiet', '-m', `chore: ${path}`, '--', path);
      // Git ran synchronously, so any clear from here on follows this commit.
      await new Promise<void>((resolve) => (cleared = resolve));
    };
    // Hold the first move's carry until the second move has been handled.
    const messages = GitDiffParser.prototype.getCommitMessages;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let reached = () => {};
    const holding = new Promise<void>((resolve) => (reached = resolve));
    let calls = 0;
    vi.spyOn(GitDiffParser.prototype, 'getCommitMessages').mockImplementation(async function (
      this: GitDiffParser,
      ...args
    ) {
      calls += 1;
      if (calls === 1) {
        reached();
        await held;
      }
      return messages.apply(this, args);
    });

    const parse = GitDiffParser.prototype.parseDiff;
    let parsed = () => {};
    vi.spyOn(GitDiffParser.prototype, 'parseDiff').mockImplementation(async function (
      this: GitDiffParser,
      ...args
    ) {
      const diff = await parse.apply(this, args);
      parsed();
      return diff;
    });

    await moveHead('one.txt');
    const first = request<DiffResponse>('/api/diff?base=HEAD&target=staged');
    await holding;
    await moveHead('two.txt');
    const secondParsed = new Promise<void>((resolve) => (parsed = resolve));
    const second = request<DiffResponse>('/api/diff?base=HEAD&target=staged');
    // Let the second request handle its move before the first one finishes.
    await secondParsed;
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const middle = await first;
    const latest = await second;
    expect(latest.baseCommitish).not.toBe(middle.baseCommitish);
    expect(await request<ReviewSummary>(summaryPath(latest))).toMatchObject({
      commitMessage: 'feat: stage the draft',
      rationale: 'Keep the staged proposal.',
    });
  });

  it('keeps the launch summary when a commit moves HEAD under a staged review', async () => {
    git('add', 'fixture.txt');
    await start({
      diffMode: DiffMode.STAGED,
      selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
      commitMessage: 'feat: stage the draft',
      why: 'Keep the staged proposal.',
    });
    const before = await request<DiffResponse>('/api/diff');
    const launchSummary = await request<ReviewSummary>(summaryPath(before));
    expect(launchSummary).toMatchObject({ commitMessage: 'feat: stage the draft', version: 1 });

    // Commit another path only, so HEAD moves while fixture.txt stays staged.
    writeFileSync(join(root, 'other.txt'), 'unrelated\n');
    git('add', 'other.txt');
    git('commit', '--quiet', '-m', 'chore: unrelated', '--', 'other.txt');

    // The file watcher clears the resolved-commit cache after its debounce.
    let after = before;
    await vi.waitFor(
      async () => {
        after = await request<DiffResponse>('/api/diff?base=HEAD&target=staged');
        expect(after.baseCommitish).not.toBe(before.baseCommitish);
      },
      { timeout: 5000, interval: 100 },
    );
    expect(await request<ReviewSummary>(summaryPath(after))).toMatchObject({
      commitMessage: 'feat: stage the draft',
      rationale: 'Keep the staged proposal.',
    });
  });

  it('starts the next staged review without the summary of the change that landed', async () => {
    git('add', 'fixture.txt');
    await start({
      diffMode: DiffMode.STAGED,
      selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
      commitMessage: 'feat: stage the draft',
      why: 'Keep the staged proposal.',
    });
    const before = await request<DiffResponse>('/api/diff');

    // Another message, so only the empty diff keeps the summary from following.
    git('commit', '--quiet', '-m', 'feat: landed under another message');
    let landed = before;
    await vi.waitFor(
      async () => {
        landed = await request<DiffResponse>('/api/diff?base=HEAD&target=staged');
        expect(landed.baseCommitish).not.toBe(before.baseCommitish);
      },
      { timeout: 5000, interval: 100 },
    );
    expect(landed.isEmpty).toBe(true);

    writeFileSync(join(root, 'fixture.txt'), 'next draft\n');
    git('add', 'fixture.txt');
    let next = landed;
    await vi.waitFor(
      async () => {
        next = await request<DiffResponse>('/api/diff?base=HEAD&target=staged');
        expect(next.isEmpty).toBe(false);
      },
      { timeout: 5000, interval: 100 },
    );
    expect(await request<ReviewSummary>(summaryPath(next))).toMatchObject({
      commitMessage: '',
      rationale: '',
      version: 0,
    });
  });

  it('does not carry the landed commit message to the next staged change', async () => {
    git('add', 'fixture.txt');
    await start({
      diffMode: DiffMode.STAGED,
      selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
      commitMessage: 'feat: stage the draft\n\n\nWith a body.  \n',
      why: 'Keep the staged proposal.',
    });
    const before = await request<DiffResponse>('/api/diff');

    // The browser fetches only on Reload, so it may never see the empty index.
    // Git normalizes the message's whitespace, and --signoff appends a trailer.
    git('commit', '--quiet', '--signoff', '-m', 'feat: stage the draft\n\n\nWith a body.  ');
    writeFileSync(join(root, 'fixture.txt'), 'next draft\n');
    git('add', 'fixture.txt');
    let next = before;
    await vi.waitFor(
      async () => {
        next = await request<DiffResponse>('/api/diff?base=HEAD&target=staged');
        expect(next.baseCommitish).not.toBe(before.baseCommitish);
      },
      { timeout: 5000, interval: 100 },
    );
    expect(next.isEmpty).toBe(false);
    expect(await request<ReviewSummary>(summaryPath(next))).toMatchObject({
      commitMessage: '',
      version: 0,
    });
  });

  it('carries the summary of a whitespace-only change while whitespace is hidden', async () => {
    writeFileSync(join(root, 'fixture.txt'), 'revision 2 \n');
    git('add', 'fixture.txt');
    await start({
      diffMode: DiffMode.STAGED,
      selection: { baseCommitish: 'HEAD', targetCommitish: 'staged' },
      commitMessage: 'style: trailing space',
      why: 'Keep the whitespace proposal.',
    });
    const before = await request<DiffResponse>('/api/diff?ignoreWhitespace=true');
    expect(before.isEmpty).toBe(true);

    writeFileSync(join(root, 'other.txt'), 'unrelated\n');
    git('add', 'other.txt');
    git('commit', '--quiet', '-m', 'chore: unrelated', '--', 'other.txt');
    let after = before;
    await vi.waitFor(
      async () => {
        after = await request<DiffResponse>(
          '/api/diff?base=HEAD&target=staged&ignoreWhitespace=true',
        );
        expect(after.baseCommitish).not.toBe(before.baseCommitish);
      },
      { timeout: 5000, interval: 100 },
    );
    expect(await request<ReviewSummary>(summaryPath(after))).toMatchObject({
      commitMessage: 'style: trailing space',
    });
  });

  it('keeps named captures as proposals and retains their explicit summary and identity', async () => {
    const capture = await captureWorkingTree({ cwd: root });
    await start({
      namedReview: { name: 'task', capture },
      commitMessage: 'feat: captured proposal',
      why: 'Keep the named task draft.',
    });
    const diff = await request<DiffResponse>('/api/diff?review=task');
    const summary = await request<ReviewSummary>('/api/review-summary?review=task');
    const snapshot = await request<ConversationSnapshot>('/api/conversation/snapshot');
    expect(diff.targetCommitMessage).toBeUndefined();
    expect(diff.capture?.patchDigest).toBe(capture.patchDigest);
    expect(summary).toMatchObject({ commitMessage: 'feat: captured proposal', version: 1 });
    await request('/api/diff?review=task');
    expect(await request('/api/review-summary?review=task')).toEqual(summary);
    const refreshed = await request<ConversationSnapshot>('/api/conversation/snapshot');
    expect(refreshed.reviews[0]?.id).toBe(snapshot.reviews[0]?.id);
    expect(refreshed.reviews[0]?.capture).toEqual(snapshot.reviews[0]?.capture);
  });
});
