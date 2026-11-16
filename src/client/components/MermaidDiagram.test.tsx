import { render, screen } from '@testing-library/react';
import mermaid from 'mermaid';
import { describe, expect, it, vi } from 'vitest';

import { MermaidDiagram } from './MermaidDiagram';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

describe('MermaidDiagram', () => {
  it('opens off-origin click links in a new tab without a referrer', async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg:
        '<svg><a id="off" xlink:href="https://example.com/a"><text>off</text></a>' +
        `<a id="same" xlink:href="${location.origin}/x"><text>same</text></a>` +
        '<a id="rel" xlink:href="/local"><text>rel</text></a>' +
        '<foreignObject><div><a id="label" href="https://example.com/b">label</a></div></foreignObject></svg>',
      diagramType: 'flowchart',
      bindFunctions: undefined,
    });

    render(<MermaidDiagram chart="graph TD" />);

    const diagram = await screen.findByLabelText('Mermaid diagram');
    await vi.waitFor(() => {
      expect(diagram.querySelector('#off')).not.toBeNull();
    });
    for (const id of ['#off', '#label']) {
      const link = diagram.querySelector(id);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
    for (const id of ['#same', '#rel']) {
      const link = diagram.querySelector(id);
      expect(link).not.toHaveAttribute('target');
      expect(link).not.toHaveAttribute('rel');
    }
  });
});
