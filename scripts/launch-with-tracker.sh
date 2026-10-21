#!/usr/bin/env bash
# Starts litrpg-tracker's own Vite dev server first, then NEO — so the
# tracker panel's first hover doesn't eat a cold-start delay — and kills
# the server again once NEO exits. Meant to be invoked from the "NEO"
# Application launcher entry (see ~/.local/share/applications/neo.desktop),
# not run directly as part of the build.
#
# Runs vite's own binary rather than `npm run dev`: npm doesn't reliably
# forward a terminating signal to the script it runs, which would leave
# vite itself still running after this script's cleanup trap fires.
set -u

TRACKER_DIR="$HOME/Projects/litrpg-tracker"
NEO_DIR="$HOME/Projects/neo"

VITE_PID=""
if [ -x "$TRACKER_DIR/node_modules/.bin/vite" ]; then
  ( cd "$TRACKER_DIR" && exec ./node_modules/.bin/vite ) >/dev/null 2>&1 &
  VITE_PID=$!
fi

cleanup() {
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
}
trap cleanup EXIT

# Give the dev server a head start — poll briefly, but move on regardless
# so a slow or missing tracker checkout never blocks NEO from opening.
if [ -n "$VITE_PID" ]; then
  for _ in $(seq 1 20); do
    curl -fsS "http://localhost:5173/__dataset" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

cd "$NEO_DIR" && env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
# cleanup (killing the tracker's dev server) runs via the EXIT trap above
# once this returns — never `exec` this line, or the trap never fires.
