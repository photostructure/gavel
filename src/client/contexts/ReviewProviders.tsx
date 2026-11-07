import type { ReactNode } from 'react';

import { CommentDraftScope } from '../hooks/useCommentDrafts';

import { AgentUpdatesContext, type AgentUpdatesReadState } from './AgentUpdatesContext';
import { WordHighlightProvider } from './WordHighlightContext';

export function ReviewProviders({
  agentUpdates,
  draftScope,
  children,
}: {
  agentUpdates: AgentUpdatesReadState;
  draftScope: string;
  children: ReactNode;
}) {
  return (
    <AgentUpdatesContext.Provider value={agentUpdates}>
      <CommentDraftScope value={draftScope}>
        <WordHighlightProvider>{children}</WordHighlightProvider>
      </CommentDraftScope>
    </AgentUpdatesContext.Provider>
  );
}
