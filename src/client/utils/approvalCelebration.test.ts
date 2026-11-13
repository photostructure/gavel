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
  /** Calls to each context method since the counts were last cleared. */
  let calls: Map<PropertyKey, number>;
  let frame: FrameRequestCallback | undefined;
  let source: HTMLButtonElement;

  beforeEach(() => {
    drawCalls = 0;
    calls = new Map();
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
                  calls.set(name, (calls.get(name) ?? 0) + 1);
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

  // Opening another review ends the burst, so it does not play over a review it was not for.
  it('stops and removes its canvas when the stop it returns is called', () => {
    const stop = celebrateApproval(source, only('confetti'));
    expect(document.querySelector('canvas')).not.toBeNull();
    stop();
    expect(document.querySelector('canvas')).toBeNull();
    const tick = frame;
    frame = undefined;
    drawCalls = 0;
    tick?.(performance.now() + 1000 / 60);
    expect(frame).toBeUndefined();
    expect(drawCalls).toBe(0);
  });

  it.each(ANIMATIONS)(
    'plays %s to the end within 3 seconds and removes its canvas',
    (animation) => {
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
      expect(frames).toBeLessThanOrEqual(60 * 3);
      expect(document.querySelector('canvas')).toBeNull();
    },
  );

  it('stops painting disco light specks once the ball starts to rise', () => {
    celebrateApproval(source, only('disco'));

    // Records the specks painted in each frame, keyed by seconds since launch.
    const specks: [number, number][] = [];
    const start = performance.now();
    for (let now = start; frame;) {
      const tick = frame;
      frame = undefined;
      now += 1000 / 60;
      calls.clear();
      tick(now);
      specks.push([(now - start) / 1000, calls.get('ellipse') ?? 0]);
    }

    // The ball rests on its line for 1.8 seconds before it is pulled back up.
    const resting = specks.filter(([t]) => t > 0.6 && t < 1.75);
    const rising = specks.filter(([t]) => t > 1.825);
    expect(resting.every(([, count]) => count > 0)).toBe(true);
    expect(rising.length).toBeGreaterThan(0);
    expect(rising.every(([, count]) => count === 0)).toBe(true);
  });

  it('fills each streamer face once, so fading strips show no lines where segments meet', () => {
    // Measured in headless Chromium: stroking each segment blends the overlaps twice
    // while the burst fades (alpha 156–220 where segments meet, against 128 inside,
    // at globalAlpha 0.5), and filling each segment alone leaves anti-aliasing gaps
    // there (alpha down to 190 of 255 at full opacity).
    celebrateApproval(source, only('streamers'));

    // The streamers burst launches 16 of them.
    const streamers = 16;
    const start = performance.now();
    let segments = 0;
    let fills = 0;
    let strokes = 0;
    for (let now = start; frame && now - start < 2000;) {
      const tick = frame;
      frame = undefined;
      now += 1000 / 60;
      calls.clear();
      tick(now);
      segments = Math.max(segments, calls.get('moveTo') ?? 0);
      fills = Math.max(fills, calls.get('fill') ?? 0);
      strokes += calls.get('stroke') ?? 0;
    }

    // Many segments per streamer, but at most a front fill and a back fill for each.
    expect(segments).toBeGreaterThan(streamers * 10);
    expect(fills).toBeLessThanOrEqual(streamers * 2);
    expect(strokes).toBe(0);
  });
});
