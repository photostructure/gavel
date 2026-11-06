import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type ApprovalAnimation } from '../components/SettingsModal';
import { celebrateApproval, pickApprovalAnimation } from './approvalCelebration';

const ANIMATIONS = Object.keys(DEFAULT_SETTINGS.approvalAnimations) as ApprovalAnimation[];

const only = (animation: ApprovalAnimation | null) =>
  Object.fromEntries(ANIMATIONS.map((id) => [id, id === animation])) as Record<
    ApprovalAnimation,
    boolean
  >;

describe('pickApprovalAnimation', () => {
  it('picks nothing when every animation is turned off', () => {
    expect(pickApprovalAnimation(only(null))).toBeNull();
  });

  it.each(ANIMATIONS)('picks %s when it is the one enabled animation', (animation) => {
    for (let i = 0; i < 20; i++) expect(pickApprovalAnimation(only(animation))).toBe(animation);
  });
});

describe('celebrateApproval', () => {
  let drawCalls: number;
  let ellipseCalls: number;
  let frame: FrameRequestCallback | undefined;
  let source: HTMLButtonElement;

  beforeEach(() => {
    drawCalls = 0;
    ellipseCalls = 0;
    frame = undefined;
    // happy-dom has no 2D context. This stand-in keeps assigned properties and
    // counts method calls; methods return it so gradients can be configured.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const properties = new Map<PropertyKey, unknown>();
      const ctx: object = new Proxy(
        {},
        {
          get: (_, name) =>
            properties.has(name)
              ? properties.get(name)
              : () => {
                  drawCalls++;
                  if (name === 'ellipse') ellipseCalls++;
                  return ctx;
                },
          set: (_, name, value) => {
            properties.set(name, value);
            return true;
          },
        },
      );
      return ctx as never;
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    source = document.createElement('button');
    document.body.appendChild(source);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('does nothing when every animation is turned off', () => {
    celebrateApproval(source, only(null));

    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it.each(ANIMATIONS)('plays %s to the end and removes its canvas', (animation) => {
    celebrateApproval(source, only(animation));
    expect(document.querySelector('canvas')).not.toBeNull();

    let now = performance.now();
    let frames = 0;
    for (; frame && frames < 60 * 10; frames++) {
      const tick = frame;
      frame = undefined;
      now += 1000 / 60;
      tick(now);
    }

    expect(drawCalls).toBeGreaterThan(0);
    expect(frames).toBeLessThan(60 * 10);
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('stops painting disco light specks once the ball starts to rise', () => {
    celebrateApproval(source, only('disco'));

    // Records the specks painted in each frame, keyed by seconds since launch.
    const specks: [number, number][] = [];
    const start = performance.now();
    for (let now = start; frame;) {
      const tick = frame;
      frame = undefined;
      now += 1000 / 60;
      ellipseCalls = 0;
      tick(now);
      specks.push([(now - start) / 1000, ellipseCalls]);
    }

    // The ball rests on its line for 3.6 seconds before it is pulled back up.
    const resting = specks.filter(([t]) => t > 1.2 && t < 3.5);
    const rising = specks.filter(([t]) => t > 3.65);
    expect(resting.every(([, count]) => count > 0)).toBe(true);
    expect(rising.length).toBeGreaterThan(0);
    expect(rising.every(([, count]) => count === 0)).toBe(true);
  });
});
