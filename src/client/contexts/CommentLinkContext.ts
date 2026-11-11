import { createContext } from 'react';

import type { DiffSelection } from '../../types/diff';

/** The thread a link was written in, and its review when that is not the open one. */
export interface CommentLinkSource {
  threadId: string;
  review?: DiffSelection;
  /** The thread belongs to a review an agent deleted, so its relative links point nowhere. */
  deleted?: true;
}

export type FollowCommentLink = (href: string, source?: CommentLinkSource) => void;

// Follows gavel links in comment bodies; see useCommentLinks. Null only where a component
// renders without the App, as in tests; its links then stay ordinary anchors.
export const CommentLinkContext = createContext<FollowCommentLink | null>(null);
