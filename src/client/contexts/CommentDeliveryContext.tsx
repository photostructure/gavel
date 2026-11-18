import { createContext } from 'react';

/**
 * Whether the reviewer's comments can reach the agent: `down` while the header robot is dead,
 * and `unsent` naming the messages whose add or edit still waits in this page.
 */
export interface CommentDelivery {
  down: boolean;
  unsent: ReadonlySet<string>;
}

export const CommentDeliveryContext = createContext<CommentDelivery>({
  down: false,
  unsent: new Set(),
});
