import { fireEvent, render, screen } from '@testing-library/react';
import mermaid from 'mermaid';
import { describe, expect, it, vi } from 'vitest';

import { CommentLinkContext } from '../contexts/CommentLinkContext';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';

import { CommentBodyRenderer } from './CommentBodyRenderer';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({
      svg: '<svg><title>Mermaid</title></svg>',
      bindFunctions: undefined,
    }),
  },
}));

describe('CommentBodyRenderer', () => {
  it('renders plain text', () => {
    render(<CommentBodyRenderer body="Just a plain comment" />);

    expect(screen.getByText('Just a plain comment')).toBeInTheDocument();
  });

  it('renders bold text as <strong>', () => {
    const { container } = render(<CommentBodyRenderer body="This is **important**" />);

    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong).toHaveTextContent('important');
  });

  it('renders inline code as <code>', () => {
    const { container } = render(<CommentBodyRenderer body="Use `foo()` here" />);

    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent('foo()');
  });

  it('renders strikethrough via GFM', () => {
    const { container } = render(<CommentBodyRenderer body="~~removed~~" />);

    const del = container.querySelector('del');
    expect(del).not.toBeNull();
    expect(del).toHaveTextContent('removed');
  });

  it('keeps single newlines as line breaks', () => {
    const { container } = render(<CommentBodyRenderer body={'line one\nline two'} />);

    expect(container.querySelector('br')).not.toBeNull();
    expect(container).toHaveTextContent('line one');
    expect(container).toHaveTextContent('line two');
  });

  it('keeps consecutive spaces inside paragraphs', () => {
    const { container } = render(<CommentBodyRenderer body={'aligned:    value'} />);

    const paragraph = container.querySelector('p');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.textContent).toBe('aligned:    value');
    expect(paragraph?.className).toContain('whitespace-pre-wrap');
  });

  it('treats 4-space indented lines as code blocks (markdown semantics)', () => {
    const { container } = render(<CommentBodyRenderer body={'intro\n\n    indented line'} />);

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre).toHaveTextContent('indented line');
  });

  it('renders fenced code blocks inside <pre>', () => {
    const { container } = render(
      <CommentBodyRenderer body={'Check this:\n\n```ts\nconst x = 1;\n```'} />,
    );

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre).toHaveTextContent('const x = 1;');
  });

  it('keeps each line of a multi-line fenced code block on its own line', () => {
    const { container } = render(
      <CommentBodyRenderer body={'```js\nconsole.log(1);\n// comment\nconsole.log(2);\n```'} />,
    );

    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe('console.log(1);\n// comment\nconsole.log(2);');
  });

  it('renders fenced diff blocks with addition/deletion backgrounds', () => {
    const { container } = render(
      <CommentBodyRenderer body={'```diff\n- const x = 1;\n+ const x = 2;\n  unchanged\n```'} />,
    );

    const addedLine = container.querySelector('.bg-diff-addition-bg');
    const deletedLine = container.querySelector('.bg-diff-deletion-bg');
    expect(addedLine).not.toBeNull();
    expect(addedLine).toHaveTextContent('+ const x = 2;');
    expect(deletedLine).not.toBeNull();
    expect(deletedLine).toHaveTextContent('- const x = 1;');
    expect(container).toHaveTextContent('unchanged');
  });

  it('renders fenced mermaid blocks as diagrams', async () => {
    render(<CommentBodyRenderer body={'See:\n\n```mermaid\ngraph TD\n  A --> B\n```'} />);

    const diagram = await screen.findByLabelText('Mermaid diagram');
    await vi.waitFor(() => {
      expect(diagram.querySelector('svg')).not.toBeNull();
    });
    expect(vi.mocked(mermaid.render)).toHaveBeenCalledWith(
      expect.stringContaining('mermaid-diagram-'),
      'graph TD\n  A --> B',
    );
  });

  it('falls back to source when mermaid rendering fails in a comment', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error'));

    render(<CommentBodyRenderer body={'```mermaid\ninvalid\n```'} />);

    expect(await screen.findByText('Unable to render Mermaid diagram.')).toBeInTheDocument();
    expect(screen.getByText('invalid')).toBeInTheDocument();
  });

  it('renders safe links as anchors', () => {
    const { container } = render(
      <CommentBodyRenderer body="See [docs](https://example.com/docs)" />,
    );

    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', 'https://example.com/docs');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveTextContent('docs');
  });

  it('does not render unsafe links as anchors', () => {
    const { container } = render(<CommentBodyRenderer body="Click [here](javascript:alert(1))" />);

    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('here');
  });

  it('does not render raw HTML', () => {
    const { container } = render(<CommentBodyRenderer body='<img src="x" onerror="alert(1)">' />);

    expect(container.querySelector('img')).toBeNull();
  });

  it('renders suggestion blocks with the suggested code', () => {
    const { container } = render(
      <WordHighlightProvider>
        <CommentBodyRenderer
          body={'Try this:\n\n```suggestion\nconst y = 2;\n```'}
          originalCode="const y = 1;"
        />
      </WordHighlightProvider>,
    );

    expect(container).toHaveTextContent('Try this:');
    expect(container).toHaveTextContent('const y = 2;');
    expect(container).toHaveTextContent('const y = 1;');
    expect(container.querySelector('.bg-diff-addition-bg')).not.toBeNull();
    expect(container.querySelector('.bg-diff-deletion-bg')).not.toBeNull();
  });

  it('renders markdown around suggestion blocks', () => {
    const { container } = render(
      <WordHighlightProvider>
        <CommentBodyRenderer
          body={'**Before** the block\n\n```suggestion\nnew code\n```\n\n*After* the block'}
        />
      </WordHighlightProvider>,
    );

    expect(container.querySelector('strong')).toHaveTextContent('Before');
    expect(container.querySelector('em')).toHaveTextContent('After');
    expect(container).toHaveTextContent('new code');
  });

  describe('gavel links', () => {
    const renderWithRouter = (body: string) => {
      const follow = vi.fn();
      const outerClick = vi.fn();
      render(
        <CommentLinkContext.Provider value={follow}>
          <div onClick={outerClick}>
            <CommentBodyRenderer body={body} linkSource={{ threadId: 'tour-1' }} />
          </div>
        </CommentLinkContext.Provider>,
      );
      return { follow, outerClick };
    };

    it.each(['#thread=tour-2', '?review=api-split#thread=tour-1', '#file=a.ts&line=x'])(
      'hands %s to the router with the thread it is in, and keeps the click from the card',
      (href) => {
        const { follow, outerClick } = renderWithRouter(`[next](${href})`);
        const anchor = screen.getByRole('link', { name: 'next' });
        expect(anchor).toHaveAttribute('href', href);
        expect(anchor).not.toHaveAttribute('target');
        expect(fireEvent.click(anchor)).toBe(false);
        expect(follow).toHaveBeenCalledWith(href, { threadId: 'tour-1' });
        expect(outerClick).not.toHaveBeenCalled();
      },
    );

    it("points a relative link in another named review's comment into that review", () => {
      const follow = vi.fn();
      const review = { baseCommitish: 'b', targetCommitish: '.', reviewName: 'task-b' };
      render(
        <CommentLinkContext.Provider value={follow}>
          <CommentBodyRenderer
            body="[next](#thread=t5) [api](?review=api#thread=t1)"
            linkSource={{ threadId: 't4', review }}
          />
        </CommentLinkContext.Provider>,
      );
      // A modified click or a copied address resolves the href itself.
      expect(screen.getByRole('link', { name: 'next' })).toHaveAttribute(
        'href',
        '?review=task-b#thread=t5',
      );
      expect(screen.getByRole('link', { name: 'api' })).toHaveAttribute(
        'href',
        '?review=api#thread=t1',
      );
      fireEvent.click(screen.getByRole('link', { name: 'next' }));
      expect(follow).toHaveBeenCalledWith('#thread=t5', { threadId: 't4', review });
    });

    it("points a relative link in another Git comparison's comment into that comparison", () => {
      const follow = vi.fn();
      render(
        <CommentLinkContext.Provider value={follow}>
          <CommentBodyRenderer
            body="[next](#thread=t5)"
            linkSource={{
              threadId: 't4',
              review: { baseCommitish: 'abc123', targetCommitish: '.', baseMode: 'merge-base' },
            }}
          />
        </CommentLinkContext.Provider>,
      );
      // As its review tab opens it.
      expect(screen.getByRole('link', { name: 'next' })).toHaveAttribute(
        'href',
        '?base=abc123&target=.&baseMode=merge-base&retainedReview=1#thread=t5',
      );
    });

    it('lets a modified click open the link in a new tab', () => {
      const { follow } = renderWithRouter('[next](#thread=tour-2)');
      fireEvent.click(screen.getByRole('link', { name: 'next' }), { metaKey: true });
      expect(follow).not.toHaveBeenCalled();
    });

    it('leaves a plain heading anchor to the browser', () => {
      const { follow } = renderWithRouter('[top](#summary)');
      fireEvent.click(screen.getByRole('link', { name: 'top' }));
      expect(follow).not.toHaveBeenCalled();
    });
  });
});
