import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetEmptyCommentFormsOutside } from './domUtils';

function addForm({ empty, draftKey }: { empty: boolean; draftKey?: string }) {
  const form = document.createElement('form');
  form.dataset.empty = String(empty);
  if (draftKey !== undefined) form.dataset.draftKey = draftKey;
  const textarea = document.createElement('textarea');
  form.append(textarea);
  document.body.append(form);
  const onReset = vi.fn();
  form.addEventListener('reset', onReset);
  return { form, textarea, onReset };
}

afterEach(() => document.body.replaceChildren());

describe('resetEmptyCommentFormsOutside', () => {
  it('resets empty forms that do not contain the click', () => {
    const clicked = addForm({ empty: true, draftKey: 'a' });
    const other = addForm({ empty: true, draftKey: 'b' });
    const filled = addForm({ empty: false, draftKey: 'c' });
    resetEmptyCommentFormsOutside(clicked.textarea);
    expect(clicked.onReset).not.toHaveBeenCalled();
    expect(other.onReset).toHaveBeenCalledOnce();
    expect(filled.onReset).not.toHaveBeenCalled();
  });

  it('leaves another copy of the clicked form alone, since they share one draft', () => {
    const panelCopy = addForm({ empty: true, draftKey: 'shared' });
    const diffCopy = addForm({ empty: true, draftKey: 'shared' });
    resetEmptyCommentFormsOutside(panelCopy.textarea);
    expect(diffCopy.onReset).not.toHaveBeenCalled();
  });

  it('resets every copy of a draft when the click is outside all of them', () => {
    const panelCopy = addForm({ empty: true, draftKey: 'shared' });
    const diffCopy = addForm({ empty: true, draftKey: 'shared' });
    resetEmptyCommentFormsOutside(document.body);
    expect(panelCopy.onReset).toHaveBeenCalledOnce();
    expect(diffCopy.onReset).toHaveBeenCalledOnce();
  });

  it('keeps forms that opt out of outside-click dismissal', () => {
    const kept = addForm({ empty: true });
    kept.form.dataset.dismissOnOutsideClick = 'false';
    resetEmptyCommentFormsOutside(document.body);
    expect(kept.onReset).not.toHaveBeenCalled();
  });
});
