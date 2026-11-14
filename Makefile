# Every PhotoStructure repo exposes `make preflight`: run everything that should
# pass before cutting a release -- update dependencies and pinned Actions,
# format, lint, compile, test, and scan production dependencies with Snyk.
# The steps themselves are defined in package.json.
.PHONY: preflight

preflight:
	pnpm run preflight
