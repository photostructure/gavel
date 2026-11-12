import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeaderMenu } from './HeaderMenu';

describe('HeaderMenu', () => {
  // Touch screens give toolbar buttons a 44 px minimum width, wider than an icon alone.
  it('centers its label in a button wider than the label', () => {
    render(
      <HeaderMenu title="Review" label={<span>icon</span>}>
        menu
      </HeaderMenu>,
    );
    expect(screen.getByRole('button', { name: 'icon' })).toHaveClass('justify-center');
  });
});
