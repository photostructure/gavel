#!/usr/bin/env bash
# Manual pre-release check of the harness and `gavel wait`. It runs no model and
# makes no paid API calls: a simulated browser tab posts a comment and an
# approval to a throwaway review, and `gavel wait` must report each. See README.md.
#
# Usage:
#   run.sh [--host H]
set -euo pipefail

PROJECT_ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
# This checkout's build. An array, so `timeout` can run it.
GAVEL=(node "$PROJECT_ROOT/dist/cli/index.js")
HOST=127.0.0.1
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done

STAMP=$(date +%Y%m%d-%H%M%S)
WORK=${WORKTREE_ROOT:-$HOME/src/worktrees/tmp}/gavel-wait-e2e-$STAMP
LOG=$WORK.log
REVIEW=e2e
PIDS=()

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; exit 1; }
# Every /api request carries this user's access token, which gavel creates when it first starts.
token() { cat "${GAVEL_CONFIG_DIR:-$HOME/.gavel}/access-token"; }
api() { curl -sf -H "X-Gavel-Token: $(token)" "http://$HOST:$PORT$1"; }

cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  if [ -f "$WORK/server.json" ]; then
    kill "$(jq -r 'select(.pid) | .pid' "$WORK/server.json" | head -1)" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Post a user comment the way the browser does: fetch threads, append, POST.
user_comment() { # <file> <line> <body>
  local file=$1 line=$2 body=$3 now id
  now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  id=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
  # Callers use $(...), where bash suspends `set -e`, so each step returns its failure.
  api "/api/comments-json?review=$REVIEW" > "$WORK/threads.json" || return 1
  api "/api/diff?review=$REVIEW" | jq -c .capture > "$WORK/capture.json" || return 1
  jq -c --arg file "$file" --argjson line "$line" --arg body "$body" \
    --arg id "$id" --arg now "$now" \
    --slurpfile cap "$WORK/capture.json" '
    {message: {id: $id, body: $body, author: "User", intent: "comment",
               createdAt: $now, updatedAt: $now}} as $m
    | .threads += [{id: $id, filePath: $file, position: {side: "new", line: $line},
                    createdAt: $now, updatedAt: $now, messages: [$m.message]}]
    | {threads, baseVersion: .version,
       captureVersion: $cap[0].version, patchDigest: $cap[0].patchDigest}' \
    "$WORK/threads.json" > "$WORK/post.json" || return 1
  curl -sf -X POST -H 'Content-Type: application/json' -H "X-Gavel-Token: $(token)" --data @"$WORK/post.json" \
    "http://$HOST:$PORT/api/comments?review=$REVIEW" > /dev/null || return 1
  echo "$id"
}

approve() {
  local cap summary
  cap=$(api "/api/diff?review=$REVIEW" | jq -c .capture) || return 1
  # The server checks this review's summary version, not any other review's.
  summary=$("${GAVEL[@]}" comment snapshot --host "$HOST" --port "$PORT" |
    jq -e --arg r "$REVIEW" '[.reviews[] | select(.selection.reviewName == $r) | .summary.version] |
      if length == 1 then .[0] else error("expected one review named \($r)") end') || return 1
  jq -nc --argjson cap "$cap" --argjson sv "$summary" \
    '{verdict: "approve", summaryVersion: $sv, captureVersion: $cap.version, patchDigest: $cap.patchDigest}' |
    curl -sf -X PUT -H 'Content-Type: application/json' -H "X-Gavel-Token: $(token)" --data @- \
      "http://$HOST:$PORT/api/approval?review=$REVIEW" | jq -e '.verdict == "approve"' > /dev/null
}

progress() { # <message-id>
  "${GAVEL[@]}" comment snapshot --host "$HOST" --port "$PORT" |
    jq -r --arg id "$1" '[.. | objects | select(.id? == $id and has("progress")) | .progress.status] | first // "missing"'
}

mkdir -p "$WORK"
: > "$LOG"
log "log $LOG, work dir $WORK, host $HOST"

git -C "$WORK" init -q
printf 'one\ntwo\nthree\n' > "$WORK/notes.txt"
git -C "$WORK" add notes.txt
git -C "$WORK" -c user.name=e2e -c user.email=e2e@example.invalid commit -qm init
printf 'one\ntwo changed\nthree\n' > "$WORK/notes.txt"
# The server forwards review activity to the Claude Code or Codex session that launched
# it (session-inbox.ts), so unset those variables: a self-test must not post into
# whichever agent session runs it.
(cd "$WORK" && env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_MESSAGING_SOCKET -u CODEX_THREAD_ID "${GAVEL[@]}" --review "$REVIEW" --keep-alive --background --no-open \
  --host "$HOST" --commit-message "docs(notes): change two" --why "Test fixture.") \
  > "$WORK/server.json"
PORT=$(jq -r 'select(.port) | .port' "$WORK/server.json" | head -1)
[ -n "$PORT" ] || fail "gavel did not report a port"
log "gavel review $REVIEW on $HOST:$PORT"

# Hold reviewer presence open the way a browser tab does: one WebSocket on /api/live.
node -e 'const live = new WebSocket(process.argv[1]); live.onclose = () => process.exit(1);' \
  "ws://$HOST:$PORT/api/live?tab=e2e&visible=true&gavel-token=$(token)" &
HEARTBEAT=$!
PIDS+=("$HEARTBEAT")
connected() { api /api/presence | jq -r .reviewers.connected; }
for _ in $(seq 20); do [ "$(connected)" -ge 1 ] && break; sleep 0.5; done
[ "$(connected)" -ge 1 ] || fail "the simulated browser tab did not connect"

# Check the fixture, the posting helpers, and gavel wait itself.
sleep 1
ID=$(user_comment notes.txt 2 "selftest comment") || fail "posting the selftest comment failed"
[ "$(progress "$ID")" = queued ] || fail "posted comment is not queued as a user message"
OUT=$("${GAVEL[@]}" wait --host "$HOST" --port "$PORT") || fail "gavel wait exited $?"
echo "$OUT" | jq -e --arg id "$ID" '.events[] | select(.messageId == $id)' > /dev/null ||
  fail "gavel wait did not return the posted comment: $OUT"
CURSOR=$(echo "$OUT" | jq -r .cursor)
# A still-queued message is re-delivered by every wait, so receipt it first.
echo "$OUT" | jq -c --arg id "$ID" '.events[] | select(.messageId == $id) |
  {reviewId, threadId, messageId, cursor, status: "delivered"}' |
  "${GAVEL[@]}" comment status --host "$HOST" --port "$PORT" > /dev/null
( "${GAVEL[@]}" wait --host "$HOST" --port "$PORT" --after "$CURSOR" > "$WORK/wait2.json"; echo $? > "$WORK/wait2.rc" ) &
sleep 3
approve || fail "approving the selftest review failed"
for _ in $(seq 30); do [ -f "$WORK/wait2.rc" ] && break; sleep 1; done
[ "$(cat "$WORK/wait2.rc" 2>/dev/null)" = 0 ] || fail "gavel wait did not exit 0 on approval"
jq -e '.events[] | select(.type == "review.approval" and .approval.verdict == "approve")' "$WORK/wait2.json" > /dev/null ||
  fail "second wait did not report the approval: $(cat "$WORK/wait2.json")"
# Closing the reviewer's connection must end a wait with exit 4.
kill "$HEARTBEAT"
rc=0
timeout 90 "${GAVEL[@]}" wait --host "$HOST" --port "$PORT" \
  --after "$(jq -r .cursor "$WORK/wait2.json")" > /dev/null 2>&1 || rc=$?
[ "$rc" = 4 ] || fail "gavel wait exited $rc, not 4, after the reviewer disconnected"
log "PASS"
# Stop the server first: the EXIT trap finds its PID in $WORK/server.json.
cleanup
rm -rf "$WORK"
exit 0
