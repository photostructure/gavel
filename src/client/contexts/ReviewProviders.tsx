import { useMemo, type ReactNode } from 'react';

import { deliveryDown, type ServerState } from '../components/AgentDeliveryStatus';
import { CommentDraftScope } from '../hooks/useCommentDrafts';
import type { ClientInboxDelivery } from '../hooks/useInboxDelivery';

import { AgentUpdatesContext, type AgentUpdatesReadState } from './AgentUpdatesContext';
import { CommentLinkContext, type FollowCommentLink } from './CommentLinkContext';
import { CommentDeliveryContext } from './CommentDeliveryContext';
import { WordHighlightProvider } from './WordHighlightContext';

export function ReviewProviders({
  agentUpdates,
  deliveryStatus,
  server,
  unsent,
  draftScope,
  followCommentLink,
  children,
}: {
  agentUpdates: AgentUpdatesReadState;
  deliveryStatus: ClientInboxDelivery['status'] | undefined;
  server: ServerState;
  unsent: ReadonlySet<string>;
  draftScope: string;
  followCommentLink: FollowCommentLink;
  children: ReactNode;
}) {
  const down = deliveryDown(deliveryStatus, server);
  const delivery = useMemo(() => ({ down, unsent }), [down, unsent]);
  return (
    <AgentUpdatesContext.Provider value={agentUpdates}>
      <CommentDraftScope value={draftScope}>
        <CommentLinkContext.Provider value={followCommentLink}>
          <CommentDeliveryContext.Provider value={delivery}>
            <WordHighlightProvider>{children}</WordHighlightProvider>
          </CommentDeliveryContext.Provider>
        </CommentLinkContext.Provider>
      </CommentDraftScope>
    </AgentUpdatesContext.Provider>
  );
}
