#!/usr/bin/env bash
set -euo pipefail

if [[ ! "$GITHUB_REF" =~ ^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '::error::Release workflows require a vMAJOR.MINOR.PATCH tag'
  exit 1
fi

PACKAGE_NAME="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name")"
PACKAGE_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
REPOSITORY_URL="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).repository.url")"
if [[ "$PACKAGE_NAME" != @photostructure/gavel || "$GITHUB_REF_NAME" != "v$PACKAGE_VERSION" || "$REPOSITORY_URL" != "https://github.com/$GITHUB_REPOSITORY.git" ]]; then
  echo '::error::The tagged package identity does not match the fork release'
  exit 1
fi

REF_JSON="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$GITHUB_REF_NAME")"
TAG_OBJECT_SHA="$(jq -r '.object.sha' <<< "$REF_JSON")"
if [[ "$(jq -r '.object.type' <<< "$REF_JSON")" != tag ]]; then
  echo '::error::Release tag must be annotated'
  exit 1
fi
TAG_JSON="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$TAG_OBJECT_SHA")"
COMMIT_VERIFIED="$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA" --jq '.commit.verification.verified')"
if [[ "$(jq -r '.object.type' <<< "$TAG_JSON")" != commit || "$(jq -r '.object.sha' <<< "$TAG_JSON")" != "$GITHUB_SHA" || "$(jq -r '.verification.verified' <<< "$TAG_JSON")" != true || "$COMMIT_VERIFIED" != true ]]; then
  echo '::error::Release tag must point directly to this commit; tag and commit signatures must be verified'
  exit 1
fi

{
  echo "package_version=$PACKAGE_VERSION"
  echo "tag_object_sha=$TAG_OBJECT_SHA"
} >> "$GITHUB_OUTPUT"
