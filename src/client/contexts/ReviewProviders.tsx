import type { ReactNode } from 'react';

import { CommentDraftScope } from '../hooks/useCommentDrafts';

import { AgentUpdatesContext, type AgentUpdatesReadState } from './AgentUpdatesContext';
import { CommentLinkContext, type FollowCommentLink } from './CommentLinkContext';
import { WordHighlightProvider } from './WordHighlightContext';

export function ReviewProviders({
  agentUpdates,
  draftScope,
  followCommentLink,
  children,
}: {
  agentUpdates: AgentUpdatesReadState;
  draftScope: string;
  followCommentLink: FollowCommentLink;
  children: ReactNode;
}) {
  return (
    <AgentUpdatesContext.Provider value={agentUpdates}>
      <CommentDraftScope value={draftScope}>
        <CommentLinkContext.Provider value={followCommentLink}>
          <WordHighlightProvider>{children}</WordHighlightProvider>
        </CommentLinkContext.Provider>
      </CommentDraftScope>
    </AgentUpdatesContext.Provider>
  );
}
