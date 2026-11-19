import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from '../utils/clipboard';

import { onCopyFailure, useCopy } from './useCopy';

vi.mock('../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
});

describe('useCopy', () => {
  it('reports a copy for 2 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(copyTextToClipboard).mockResolvedValue();
    const { result } = renderHook(() => useCopy());
    expect(result.current.status).toBe('idle');

    await act(async () => result.current.copy('text'));
    expect(copyTextToClipboard).toHaveBeenLastCalledWith('text');
    expect(result.current.status).toBe('copied');

    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.status).toBe('copied');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.status).toBe('idle');
  });

  it('reports a failed copy for 2 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('Failed to copy text'));
    const { result } = renderHook(() => useCopy());

    await act(async () => result.current.copy('text'));
    expect(result.current.status).toBe('failed');

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.status).toBe('idle');
  });

  it('tells failure listeners about a failed copy, and only until they unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = onCopyFailure(listener);
    const { result } = renderHook(() => useCopy());

    vi.mocked(copyTextToClipboard).mockResolvedValueOnce();
    await act(async () => result.current.copy('copied'));
    expect(listener).not.toHaveBeenCalled();

    vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error('Failed to copy text'));
    await act(async () => result.current.copy('refused'));
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    vi.mocked(copyTextToClipboard).mockRejectedValueOnce(new Error('Failed to copy text'));
    await act(async () => result.current.copy('refused again'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('restarts the 2 seconds on each copy', async () => {
    vi.useFakeTimers();
    vi.mocked(copyTextToClipboard).mockResolvedValue();
    const { result } = renderHook(() => useCopy());

    await act(async () => result.current.copy('first'));
    act(() => vi.advanceTimersByTime(1500));
    await act(async () => result.current.copy('second'));
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.status).toBe('copied');
  });
});
