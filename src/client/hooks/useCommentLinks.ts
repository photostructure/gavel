import { useCallback, useEffect, useRef, useState } from 'react';

import type { CommentThread, DiffSelection } from '../../types/diff';
import { diffSelectionsEqual } from '../../utils/diffSelection';
import type { FollowCommentLink } from '../contexts/CommentLinkContext';
import { parseCommentLink, withLinkPlace, type CommentLinkPlace } from '../utils/commentLinks';
import { writeLocationHash } from '../utils/reviewNavigation';

import type { LineDraftAnchor } from './useCommentDrafts';

interface UseCommentLinksOptions {
  // The open review's diff and comments have loaded. Switching review must make this false
  // in the same render, so a jump waiting for another review does not resolve against this one.
  ready: boolean;
  currentSelection: DiffSelection | null;
  // Every review on the server, to find a named one.
  reviews: readonly { selection: DiffSelection }[];
  threads: readonly CommentThread[];
  filePaths: readonly string[];
  switchReview: (selection: DiffSelection) => void;
  // False when the diff cannot show the line, now or by expanding context.
  canShowLine: (anchor: LineDraftAnchor) => boolean;
  jumpToLine: (anchor: LineDraftAnchor) => void;
  // Moves to a thread's line and brings its comment card into view: scrolling to the line
  // alone can leave the comment below it off screen.
  jumpToThread: (anchor: LineDraftAnchor, threadId: string) => void;
  openFile: (filePath: string) => void;
  focusInConversation: (threadId: string) => void;
}

type Resolution = { notice: string } | { run: () => void };

function describeLines(line: LineDraftAnchor['lineNumber'], filePath: string): string {
  return typeof line === 'number'
    ? `Line ${line} of "${filePath}" is not in this diff.`
    : `Lines ${line[0]}-${line[1]} of "${filePath}" are not in this diff.`;
}

function placeFromLocation(): CommentLinkPlace | { error: string } | null {
  const link = parseCommentLink(window.location.hash);
  if (link === null || 'error' in link) return link;
  return link.place ?? null;
}

/**
 * Follows gavel links in comment bodies (see commentLinks.ts) and the place the page URL
 * names. Each followed link to a new place adds a history entry and marks the entry it
 * leaves with the link's own thread, so Back returns there. A link in another review's comment (shown in
 * Conversation) leaves that entry as it was, since the open review lacks that thread.
 */
export function useCommentLinks(options: UseCommentLinksOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [notice, setNotice] = useState<string | null>(() => {
    const place = placeFromLocation();
    return place && 'error' in place ? place.error : null;
  });
  // afterSwitch: the link switched review, so the jump waits until `ready` has gone false and
  // back to true, rather than resolving against the review it is leaving.
  const [pending, setPending] = useState<{ place: CommentLinkPlace; afterSwitch: boolean } | null>(
    () => {
      const place = placeFromLocation();
      return place && !('error' in place) ? { place, afterSwitch: false } : null;
    },
  );

  const resolve = useCallback((place: CommentLinkPlace): Resolution => {
    const {
      threads,
      filePaths,
      canShowLine,
      jumpToLine,
      jumpToThread,
      openFile,
      focusInConversation,
    } = latest.current;
    if (place.kind === 'thread') {
      const thread = threads.find((candidate) => candidate.id === place.threadId);
      if (!thread) return { notice: `No comment "${place.threadId}" in this review.` };
      if (thread.scope === 'review') return { run: () => focusInConversation(thread.id) };
      const anchor: LineDraftAnchor = {
        kind: 'line',
        filePath: thread.file,
        side: thread.side ?? 'new',
        lineNumber: thread.line,
      };
      // An outdated thread's line may be gone from the diff; Conversation still shows it.
      if (!canShowLine(anchor)) return { run: () => focusInConversation(thread.id) };
      return { run: () => jumpToThread(anchor, thread.id) };
    }
    if (!filePaths.includes(place.filePath))
      return { notice: `"${place.filePath}" is not in this review.` };
    const { line } = place;
    if (line === undefined) return { run: () => openFile(place.filePath) };
    const anchor: LineDraftAnchor = {
      kind: 'line',
      filePath: place.filePath,
      side: place.side,
      lineNumber: line,
    };
    if (!canShowLine(anchor)) return { notice: describeLines(line, place.filePath) };
    return { run: () => jumpToLine(anchor) };
  }, []);

  const apply = useCallback(
    (place: CommentLinkPlace) => {
      const resolution = resolve(place);
      if ('notice' in resolution) setNotice(resolution.notice);
      else resolution.run();
    },
    [resolve],
  );

  useEffect(() => {
    if (!pending) return;
    if (!options.ready) {
      if (pending.afterSwitch) setPending({ ...pending, afterSwitch: false });
      return;
    }
    if (pending.afterSwitch) return;
    setPending(null);
    apply(pending.place);
  }, [pending, options.ready, apply]);

  useEffect(() => {
    const restorePlace = () => {
      const place = placeFromLocation();
      if (place && 'error' in place) setNotice(place.error);
      else setPending(place && { place, afterSwitch: false });
    };
    window.addEventListener('popstate', restorePlace);
    return () => window.removeEventListener('popstate', restorePlace);
  }, []);

  const follow = useCallback<FollowCommentLink>(
    (href, source) => {
      const link = parseCommentLink(href);
      if (link === null) throw new Error(`Not a gavel link: ${href}`);
      if ('error' in link) {
        setNotice(link.error);
        return;
      }
      if (source?.deleted && link.review === undefined) {
        setNotice('This comment belongs to a deleted review, so its links point nowhere.');
        return;
      }
      const { currentSelection, reviews, ready, switchReview } = latest.current;
      let target = source?.review ?? currentSelection;
      if (link.review !== undefined) {
        const named = reviews.find((review) => review.selection.reviewName === link.review);
        if (!named) {
          setNotice(`No review named "${link.review}".`);
          return;
        }
        target = named.selection;
      }
      const switches = !diffSelectionsEqual(target, currentSelection);
      let run: (() => void) | undefined;
      if (!switches && link.place && ready) {
        const resolution = resolve(link.place);
        if ('notice' in resolution) {
          setNotice(resolution.notice);
          return;
        }
        run = resolution.run;
      }
      setNotice(null);
      const hash = withLinkPlace(window.location.hash, link.place);
      // A link to the place already shown adds no entry and leaves the current one alone.
      if (switches || hash !== window.location.hash) {
        if (source && !source.review)
          writeLocationHash(
            withLinkPlace(window.location.hash, { kind: 'thread', threadId: source.threadId }),
            'replace',
          );
        // Switching review adds the link's entry itself.
        if (!switches) writeLocationHash(hash, 'push');
      }
      if (switches && target) {
        switchReview(target);
        // Switching review drops the old review's place from the URL; this link's is the new one's.
        writeLocationHash(hash, 'replace');
      }
      if (run) run();
      else if (link.place) setPending({ place: link.place, afterSwitch: switches });
    },
    [resolve],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);
  return { follow, notice, dismissNotice };
}
