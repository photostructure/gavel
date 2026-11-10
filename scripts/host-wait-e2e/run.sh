#!/usr/bin/env bash
# Manual pre-release check: does a real Claude host wait for gavel review
# feedback without waking the model while nothing happens?
#
# It counts model calls (assistant entries with `usage`) in the Claude session
# transcript, so it measures host behavior rather than gavel output. It spends
# real tokens and needs a logged-in `claude`. See README.md.
#
# Usage:
#   run.sh selftest [--host H]                     # no model; the harness and gavel wait
#   run.sh tui     [--host H] [--model M] [--idle SECONDS] [--end lgtm|absent|exit]
#   run.sh print   [--host H] [--model M]          # claude -p; see README.md for the expected result
#   run.sh desktop --session <uuid> --port P [--host H] [--idle SECONDS] [--end lgtm|absent]
#
# --end picks how the review ends, since each ending stops the agent's wait:
# lgtm approves it, absent closes the reviewer's tab (gavel wait exits 4), and
# exit kills the server (gavel wait exits 2).
set -euo pipefail

PROJECT_ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
# This checkout's build. An array, so `timeout` can run it.
GAVEL=(node "$PROJECT_ROOT/dist/cli/index.js")
MODE=${1:?usage: run.sh selftest|tui|print|desktop [options]}
shift
case "$MODE" in selftest|tui|print|desktop) ;; *) echo "unknown mode $MODE" >&2; exit 1 ;; esac
HOST=localhost MODEL=sonnet IDLE=4500 SESSION="" PORT="" END=lgtm
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=$2; shift 2 ;;
    --model) MODEL=$2; shift 2 ;;
    --idle) IDLE=$2; shift 2 ;;
    --end) END=$2; shift 2 ;;
    --session) SESSION=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
case "$END" in lgtm|absent|exit) ;; *) echo "--end must be lgtm, absent or exit" >&2; exit 1 ;; esac
if [ "$MODE" = desktop ] && [ "$END" = exit ]; then
  echo "desktop mode does not own the server; use --end lgtm or absent" >&2; exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$HOME/src/worktrees/tmp/gavel-wait-e2e-$STAMP
LOG=$WORK.log
REVIEW=e2e
TMUX_NAME=gavel-wait-e2e-$STAMP
PIDS=()

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
fail() { log "FAIL: $*"; exit 1; }
api() { curl -sf "http://$HOST:$PORT$1"; }

cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  tmux kill-session -t "$TMUX_NAME" 2>/dev/null || true
  if [ -f "$WORK/server.json" ]; then
    kill "$(jq -r 'select(.pid) | .pid' "$WORK/server.json" | head -1)" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Model calls so far: unique assistant message IDs that carry usage.
transcript() { find "$HOME/.claude/projects" -name "$SESSION.jsonl" -print -quit; }
turns() {
  local t; t=$(transcript)
  [ -n "$t" ] || { echo 0; return; }
  jq -r 'select(.type=="assistant" and .message.usage) | .message.id' "$t" | sort -u | wc -l
}

# Wait until the session has made no model call for $1 seconds. A session that
# never goes quiet for 15 minutes is waking itself on a timer, which is the
# failure this check exists to catch.
settle() {
  local quiet=$1 last now since=0 deadline=$(( $(date +%s) + 900 ))
  last=$(turns)
  while [ "$since" -lt "$quiet" ]; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "the session kept calling the model for 15 minutes"
    sleep 10
    now=$(turns)
    if [ "$now" != "$last" ]; then last=$now; since=0; else since=$((since + 10)); fi
  done
}

# A waiter started from this checkout's build or from a gavel launcher.
waiter_running() { pgrep -f "(dist/cli/index\.js|gavel) wait .*--port[= ]$PORT( |\$)" > /dev/null; }

# Post a user comment the way the browser does: fetch threads, append, POST.
user_comment() { # <file> <line> <body> [thread-id]
  local file=$1 line=$2 body=$3 thread=${4:-} now id
  now=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  id=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
  # Callers use $(...), where bash suspends `set -e`, so each step returns its failure.
  api "/api/comments-json?review=$REVIEW" > "$WORK/threads.json" || return 1
  api "/api/diff?review=$REVIEW" | jq -c .capture > "$WORK/capture.json" || return 1
  jq -c --arg file "$file" --argjson line "$line" --arg body "$body" \
    --arg thread "$thread" --arg id "$id" --arg now "$now" \
    --slurpfile cap "$WORK/capture.json" '
    {message: {id: $id, body: $body, author: "User", intent: "comment",
               createdAt: $now, updatedAt: $now}} as $m
    | .threads |= (if $thread == "" then
        . + [{id: $id, filePath: $file, position: {side: "new", line: $line},
              createdAt: $now, updatedAt: $now, messages: [$m.message]}]
      else map(if .id == $thread then .messages += [$m.message] else . end) end)
    | {threads, baseVersion: .version,
       captureVersion: $cap[0].version, patchDigest: $cap[0].patchDigest}' \
    "$WORK/threads.json" > "$WORK/post.json" || return 1
  curl -sf -X POST -H 'Content-Type: application/json' --data @"$WORK/post.json" \
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
    '{approved: true, summaryVersion: $sv, captureVersion: $cap.version, patchDigest: $cap.patchDigest}' |
    curl -sf -X POST -H 'Content-Type: application/json' --data @- \
      "http://$HOST:$PORT/api/approval?review=$REVIEW" | jq -e '.approved == true' > /dev/null
}

progress() { # <message-id>
  "${GAVEL[@]}" comment snapshot --host "$HOST" --port "$PORT" |
    jq -r --arg id "$1" '[.. | objects | select(.id? == $id and has("progress")) | .progress.status] | first // "missing"'
}

wait_for_reply() { # <message-id> <seconds>
  local deadline=$(( $(date +%s) + $2 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    [ "$(progress "$1")" = replied ] && return 0
    sleep 10
  done
  return 1
}

# Count model calls across one phase and record it.
phase() { # <name> <expect: zero|some> <command...>
  local name=$1 expect=$2 before after rc=0
  shift 2
  before=$(turns)
  "$@" || rc=$?
  after=$(turns)
  log "phase $name: $((after - before)) model calls (expected $expect)"
  [ "$rc" -eq 0 ] || fail "$name: '$*' exited $rc"
  if [ "$expect" = zero ] && [ "$after" -ne "$before" ]; then fail "$name woke the model"; fi
  if [ "$expect" = some ] && [ "$after" -eq "$before" ]; then fail "$name never woke the model"; fi
}

# The phase helpers below trigger their event themselves, so the phase's model-call
# baseline is taken before it. phase runs them under `||`, which suspends `set -e`,
# so each failing step returns explicitly.
comment_and_wait() { # <body> [thread-id]; sets LAST_ID
  LAST_ID=$(user_comment notes.txt 2 "$1" "${2:-}") || { log "posting a comment failed"; return 1; }
  wait_for_reply "$LAST_ID" 600
}
approve_and_wait() { approve || return 1; sleep 120; }
end_absent() { kill "$HEARTBEAT" || return 1; sleep 120; }
end_server() { kill "$(jq -r 'select(.pid) | .pid' "$WORK/server.json" | head -1)" || return 1; sleep 120; }

mkdir -p "$WORK"
: > "$LOG"
log "log $LOG, work dir $WORK, mode $MODE, host $HOST, model $MODEL, idle ${IDLE}s, end $END"

if [ "$MODE" != desktop ]; then
  git -C "$WORK" init -q
  printf 'one\ntwo\nthree\n' > "$WORK/notes.txt"
  git -C "$WORK" add notes.txt
  git -C "$WORK" -c user.name=e2e -c user.email=e2e@example.invalid commit -qm init
  printf 'one\ntwo changed\nthree\n' > "$WORK/notes.txt"
  (cd "$WORK" && "${GAVEL[@]}" --review "$REVIEW" --keep-alive --background --no-open \
    --host "$HOST" --commit-message "docs(notes): change two" --why "Test fixture.") \
    > "$WORK/server.json"
  PORT=$(jq -r 'select(.port) | .port' "$WORK/server.json" | head -1)
  [ -n "$PORT" ] || fail "gavel did not report a port"
  log "gavel review $REVIEW on $HOST:$PORT"
fi
[ -n "$PORT" ] || fail "--port is required for desktop mode"

# Hold reviewer presence open the way a browser tab does: one WebSocket on /api/live.
node -e 'const live = new WebSocket(process.argv[1]); live.onclose = () => process.exit(1);' \
  "ws://$HOST:$PORT/api/live?tab=e2e&visible=true" &
HEARTBEAT=$!
PIDS+=("$HEARTBEAT")
connected() { curl -s "http://$HOST:$PORT/api/presence" | jq -r .reviewers.connected; }
for _ in $(seq 20); do [ "$(connected)" -ge 1 ] && break; sleep 0.5; done
[ "$(connected)" -ge 1 ] || fail "the simulated browser tab did not connect"

if [ "$MODE" = selftest ]; then
  # No model: check the fixture, the posting helpers, and gavel wait itself.
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
  jq -e '.events[] | select(.type == "review.approval" and .approved == true)' "$WORK/wait2.json" > /dev/null ||
    fail "second wait did not report the approval: $(cat "$WORK/wait2.json")"
  # Closing the reviewer's connection must end a wait with exit 4 (--end absent).
  kill "$HEARTBEAT"
  rc=0
  timeout 90 "${GAVEL[@]}" wait --host "$HOST" --port "$PORT" \
    --after "$(jq -r .cursor "$WORK/wait2.json")" > /dev/null 2>&1 || rc=$?
  [ "$rc" = 4 ] || fail "gavel wait exited $rc, not 4, after the reviewer disconnected"
  log "PASS selftest"
  # Stop the server first: the EXIT trap finds its PID in $WORK/server.json.
  cleanup
  rm -rf "$WORK"
  exit 0
fi

# Name this checkout's skill and build, so the run tests them rather than an installed copy.
PROMPT="A gavel review named $REVIEW is running for this repository at API host $HOST port $PORT. \
Follow $PROJECT_ROOT/skills/gavel/SKILL.md, with \`${GAVEL[*]}\` as its gavel command, and \
$PROJECT_ROOT/docs/waiting-for-review.md: wait for my review \
feedback without waking yourself on a timer, answer each of my comments in its gavel thread, \
and acknowledge approval in chat. Do not edit or commit files."

case "$MODE" in
  tui)
    SESSION=$(cat /proc/sys/kernel/random/uuid)
    tmux new-session -d -s "$TMUX_NAME" -x 200 -y 50 -c "$WORK" \
      "claude --session-id $SESSION --model $MODEL --permission-mode auto"
    sleep 7
    # The folder-trust dialog defaults to "No, exit"; choose "Yes, I trust this folder".
    if tmux capture-pane -p -t "$TMUX_NAME" | grep -q 'trust this folder'; then
      tmux send-keys -t "$TMUX_NAME" Down
      sleep 0.5
      tmux send-keys -t "$TMUX_NAME" Enter
      sleep 5
    fi
    tmux send-keys -t "$TMUX_NAME" -l "$PROMPT"
    tmux send-keys -t "$TMUX_NAME" Enter
    ;;
  print)
    SESSION=$(cat /proc/sys/kernel/random/uuid)
    (cd "$WORK" && claude -p "$PROMPT" --session-id "$SESSION" --model "$MODEL" \
      --permission-mode auto --output-format stream-json --verbose > "$WORK/print.jsonl" 2>&1) &
    PIDS+=($!)
    ;;
  desktop)
    [ -n "$SESSION" ] || fail "--session is required for desktop mode"
    log "send this prompt to the desktop session, then press Enter here:"
    printf '%s\n' "$PROMPT"
    read -r
    ;;
esac
log "session $SESSION"

# Setup is done once the session has started a waiter and gone quiet.
sleep 30
[ -n "$(transcript)" ] || fail "no transcript for session $SESSION"
settle 90
waiter_running || fail "no gavel wait is running for port $PORT after setup"
log "setup used $(turns) model calls"

phase idle zero sleep "$IDLE"

# A new thread's ID is its first message's ID.
phase comment some comment_and_wait "Why change line two?"
FIRST=$LAST_ID
settle 60
phase reply some comment_and_wait "Thanks. One more question: is line three affected?" "$FIRST"
settle 60

# Each ending must wake the agent once and leave no waiter to re-arm.
case "$END" in
  lgtm)
    phase approval some approve_and_wait ;;
  absent)
    phase absent some end_absent ;;
  exit)
    phase server-exit some end_server ;;
esac
settle 60
phase after-end zero sleep 600
if waiter_running; then fail "a gavel wait is still running after the review ended"; fi

log "PASS"
