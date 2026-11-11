import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReviewContext as ReviewContextData } from '../../types/diff';
import { ReviewContext } from './ReviewContext';

const context: ReviewContextData = {
  source: 'git',
  repositoryName: 'gavel',
  repositoryPath: '/projects/worktrees/conversation-view/gavel',
  workingDirectory: '/projects/worktrees/conversation-view/gavel/src',
  hostname: 'review-host',
};

describe('ReviewContext', () => {
  it('identifies the review and exposes selectable details on demand', () => {
    const { container } = render(<ReviewContext context={context} />);
    expect(screen.getByRole('region', { name: 'Review context' })).toBeVisible();
    expect(container.querySelector('details')).toBeNull();
    expect(screen.getByText('Repository')).toBeVisible();
    expect(screen.getByText('review-host')).toBeVisible();
    expect(screen.getByText(context.workingDirectory)).toBeVisible();
  });

  it('labels imported diffs without claiming the launch directory is their repository', () => {
    render(
      <ReviewContext
        context={{ source: 'stdin', workingDirectory: '/launcher', hostname: 'host' }}
      />,
    );
    expect(screen.getByText('Imported diff')).toBeVisible();
    expect(screen.queryByText('Repository')).not.toBeInTheDocument();
    expect(screen.getByText('Launched from')).toBeInTheDocument();
  });

  it('identifies the agent session that launched the review', () => {
    render(
      <ReviewContext
        context={{
          ...context,
          agent: 'Claude Code desktop',
          agentSessionName: 'Add agent session to About',
          agentSessionId: '823b3140-526b-4b91-82b1-920d0b66d08f',
        }}
      />,
    );
    expect(screen.getByText('Agent')).toBeVisible();
    expect(screen.getByText('Claude Code desktop')).toBeVisible();
    expect(screen.getByText('Agent session name')).toBeVisible();
    expect(screen.getByText('Add agent session to About')).toBeVisible();
    expect(screen.getByText('Agent session ID')).toBeVisible();
    expect(screen.getByText('823b3140-526b-4b91-82b1-920d0b66d08f')).toBeVisible();
  });

  it('omits agent session rows when the launcher did not supply them', () => {
    render(<ReviewContext context={context} />);
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent session name')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent session ID')).not.toBeInTheDocument();
  });

  it('keeps the tab title unchanged while metadata is opened and closed', () => {
    const previousTitle = document.title;
    const { unmount } = render(<ReviewContext context={context} />);
    expect(document.title).toBe(previousTitle);
    unmount();
    expect(document.title).toBe(previousTitle);
  });

  it('groups the review and server details, without the browser address', () => {
    render(<ReviewContext context={context} />);
    const review = screen.getByRole('heading', { name: 'This review' }).parentElement!;
    expect(within(review).getByText('Worktree')).toBeVisible();
    const server = screen.getByRole('heading', { name: 'Server' }).parentElement!;
    expect(within(server).getByText('Launched from')).toBeVisible();
    expect(screen.queryByText('Browser address')).not.toBeInTheDocument();
  });

  it('renders nothing for older servers without context', () => {
    const { container } = render(<ReviewContext />);
    expect(container).toBeEmptyDOMElement();
  });
});
