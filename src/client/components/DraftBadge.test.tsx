import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DraftBadge } from './DraftBadge';

describe('DraftBadge', () => {
  it('shows the number of unsent drafts', () => {
    render(<DraftBadge count={2} />);
    expect(screen.getByTestId('draft-badge')).toHaveTextContent('2');
  });

  it('shows nothing without drafts', () => {
    const { container } = render(<DraftBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
