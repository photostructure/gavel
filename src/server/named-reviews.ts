import type { DiffSelection } from '../types/diff.js';
import type { NamedReviewMetadata, ReviewCapture } from '../types/review.js';
import { createDiffSelection } from '../utils/diffSelection.js';
import { validateReviewName } from '../utils/review-name.js';

import { validateCapture } from './review-capture.js';

export interface NamedReviewState {
  metadata: NamedReviewMetadata;
  capture: ReviewCapture;
  selection: DiffSelection;
}

export class NamedReviewError extends Error {
  readonly status: number;
  readonly current?: NamedReviewMetadata;

  constructor(message: string, status: number, current?: NamedReviewMetadata) {
    super(message);
    this.name = 'NamedReviewError';
    this.status = status;
    if (current) this.current = { ...current };
  }
}

interface ReviewHistory {
  current: NamedReviewState;
  versions: Map<number, NamedReviewState>;
}

/** Stores frozen captures under a stable name for one canonical repository root. */
export class NamedReviewStore {
  private readonly reviews = new Map<string, ReviewHistory>();
  private readonly repository: { repositoryRoot: string; repositoryId: string };

  constructor(repository: { repositoryRoot: string; repositoryId: string }) {
    this.repository = { ...repository };
  }

  create(name: string, capture: unknown): NamedReviewState {
    const reviewName = this.validateName(name);
    if (this.reviews.has(reviewName)) {
      throw new NamedReviewError(`Review "${reviewName}" already exists`, 409);
    }
    const validated = this.validateRepositoryCapture(capture);
    const review = this.createState(reviewName, 1, validated);
    this.reviews.set(reviewName, { current: review, versions: new Map([[1, review]]) });
    return structuredClone(review);
  }

  /** Recreates a review saved by an earlier server from its captures, oldest first. */
  restore(name: string, captures: unknown[]): NamedReviewState {
    const reviewName = this.validateName(name);
    if (this.reviews.has(reviewName)) {
      throw new NamedReviewError(`Review "${reviewName}" already exists`, 409);
    }
    const versions = new Map<number, NamedReviewState>();
    captures.forEach((capture, index) =>
      versions.set(
        index + 1,
        this.createState(reviewName, index + 1, this.validateRepositoryCapture(capture)),
      ),
    );
    const current = versions.get(captures.length);
    if (!current) throw new NamedReviewError(`Saved review "${reviewName}" has no capture`, 500);
    this.reviews.set(reviewName, { current, versions });
    return structuredClone(current);
  }

  /** Every capture version of a review, oldest first. */
  history(name: string): NamedReviewState[] {
    const history = this.reviews.get(this.validateName(name));
    return history ? [...history.versions.values()].map((review) => structuredClone(review)) : [];
  }

  get(name: string, version?: number): NamedReviewState | undefined {
    const reviewName = this.validateName(name);
    if (version !== undefined) this.validateVersion(version);
    const history = this.reviews.get(reviewName);
    const review = version === undefined ? history?.current : history?.versions.get(version);
    return review ? structuredClone(review) : undefined;
  }

  update(
    name: string,
    expectedVersion: number,
    capture: unknown,
  ): { review: NamedReviewState; changed: boolean } {
    const reviewName = this.validateName(name);
    this.validateVersion(expectedVersion);
    const history = this.reviews.get(reviewName);
    if (!history) throw new NamedReviewError(`Review "${reviewName}" does not exist`, 404);
    const current = history.current;
    if (expectedVersion !== current.metadata.version) {
      throw new NamedReviewError(
        'Review capture changed; fetch its current version and retry',
        409,
        current.metadata,
      );
    }
    const validated = this.validateRepositoryCapture(capture);
    if (validated.patchDigest === current.metadata.patchDigest) {
      return { review: structuredClone(current), changed: false };
    }
    const review = this.createState(reviewName, current.metadata.version + 1, validated);
    history.versions.set(review.metadata.version, review);
    history.current = review;
    return { review: structuredClone(review), changed: true };
  }

  /** Moves a review and every capture version to a new name; the capture versions stay. */
  rename(name: string, newName: string): NamedReviewState {
    const reviewName = this.validateName(name);
    const nextName = this.validateName(newName);
    const history = this.reviews.get(reviewName);
    if (!history) throw new NamedReviewError(`Review "${reviewName}" does not exist`, 404);
    if (this.reviews.has(nextName)) {
      throw new NamedReviewError(`Review "${nextName}" already exists`, 409);
    }
    const renamed = (review: NamedReviewState) =>
      this.createState(nextName, review.metadata.version, review.capture);
    const versions = new Map(
      [...history.versions].map(([version, review]) => [version, renamed(review)]),
    );
    const current = renamed(history.current);
    this.reviews.delete(reviewName);
    this.reviews.set(nextName, { current, versions });
    return structuredClone(current);
  }

  /** Forgets a review and its capture history; the name is free for a new review. */
  delete(name: string): NamedReviewState {
    const reviewName = this.validateName(name);
    const history = this.reviews.get(reviewName);
    if (!history) throw new NamedReviewError(`Review "${reviewName}" does not exist`, 404);
    this.reviews.delete(reviewName);
    return structuredClone(history.current);
  }

  private validateName(name: unknown): string {
    try {
      return validateReviewName(name);
    } catch (error) {
      throw new NamedReviewError(
        error instanceof Error ? error.message : 'Invalid review name',
        400,
      );
    }
  }

  private validateVersion(version: number): void {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new NamedReviewError('Review capture version must be a positive integer', 400);
    }
  }

  private validateRepositoryCapture(value: unknown): ReviewCapture {
    let capture: ReviewCapture;
    try {
      capture = validateCapture(value);
    } catch (error) {
      throw new NamedReviewError(
        error instanceof Error ? error.message : 'Invalid review capture',
        400,
      );
    }
    if (
      capture.repositoryId !== this.repository.repositoryId ||
      capture.repositoryRoot !== this.repository.repositoryRoot
    ) {
      throw new NamedReviewError('Review capture belongs to a different repository', 400);
    }
    return structuredClone(capture);
  }

  private createState(name: string, version: number, capture: ReviewCapture): NamedReviewState {
    return {
      metadata: {
        name,
        version,
        patchDigest: capture.patchDigest,
        baseCommit: capture.baseCommit,
        repositoryId: capture.repositoryId,
      },
      capture,
      selection: createDiffSelection(capture.baseCommit, '.', undefined, name),
    };
  }
}
