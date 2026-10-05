#!/bin/bash
# Start YAP: set up (first time only), start YAP and open it in Google Chrome.
# Double-click this file in Finder. It works from whatever folder it sits in
# (spaces in the path are fine). It installs nothing outside this folder.

pause_if_terminal() {
  if [ -t 0 ] && [ -z "${YAP_NO_PAUSE:-}" ]; then
    printf '\nPress Return to close this window. '
    read -r _ || true
  fi
}
fail() { printf '\n%s\n' "$1"; pause_if_terminal; exit "${2:-1}"; }

case "$0" in */*) here="${0%/*}" ;; *) here="." ;; esac
cd -- "$here" 2>/dev/null || fail "YAP could not open its own folder ($here)."
cd -P . || fail "YAP could not open its own folder."

# --- find Node 18+ (identical in Start YAP.command and Stop YAP.command; a test keeps them in step) ---
# Looks on the ordinary PATH, then in common Mac install places. It only looks:
# nothing is installed, and no shell profile or global setting is changed.
NODE=""
OLD_NODE=""
node_ok() {
  [ -x "$1" ] || return 1
  local major
  major="$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$major" -ge 18 ]; then return 0; fi
  OLD_NODE="$1 (Node $major)"
  return 1
}
find_node() {
  local dir pat common i
  local -a dirs pats matches
  IFS=: read -r -a dirs <<< "$PATH"
  for dir in "${dirs[@]}"; do
    [ -n "$dir" ] || continue
    if node_ok "$dir/node"; then NODE="$dir/node"; return 0; fi
  done
  if [ "${YAP_COMMON_NODE_PATHS+set}" = set ]; then common="$YAP_COMMON_NODE_PATHS"
  else common="/opt/homebrew/bin/node:/usr/local/bin/node:/opt/local/bin/node:$HOME/.volta/bin/node:$HOME/.local/bin/node:$HOME/.nvm/versions/node/*/bin/node:$HOME/.fnm/node-versions/*/installation/bin/node:$HOME/Library/Application Support/fnm/node-versions/*/installation/bin/node:$HOME/.asdf/installs/nodejs/*/bin/node:/usr/local/n/versions/node/*/bin/node"; fi
  IFS=: read -r -a pats <<< "$common"
  for pat in "${pats[@]}"; do
    [ -n "$pat" ] || continue
    matches=()
    while IFS= read -r dir; do matches+=("$dir"); done < <(compgen -G "$pat" || true)
    # Newest version folder sorts last, so try the last match first.
    for (( i=${#matches[@]}-1; i>=0; i-- )); do
      if node_ok "${matches[$i]}"; then NODE="${matches[$i]}"; return 0; fi
    done
  done
  return 1
}
# --- end finder ---

find_node || {
  if [ -n "$OLD_NODE" ]; then
    fail "YAP needs Node.js 18 or newer, but the only Node found was $OLD_NODE.
YAP has not changed anything. Install the current LTS from https://nodejs.org (a normal macOS installer you run yourself), then double-click this file again." 1
  fi
  fail "YAP needs Node.js 18 or newer, and none was found on this Mac.
YAP has not installed anything. Install the current LTS from https://nodejs.org (a normal macOS installer you run yourself), then double-click this file again." 1
}
# npm's own scripts look for "node" on PATH, which a Finder launch may lack.
# This only affects this one run.
PATH="${NODE%/*}:$PATH"; export PATH

if [ ! -f scripts/launch.js ]; then
  fail "This does not look like the unzipped YAP folder (scripts/launch.js is missing). Unzip yap.zip again and double-click Start YAP.command inside it." 1
fi
extra=()
[ -n "${YAP_LAUNCH_DRY_RUN:-}" ] && extra+=(--dry-run)
"$NODE" scripts/launch.js start "${extra[@]}" "$@"
status=$?
if [ "$status" -ne 0 ]; then
  printf '\n(YAP exit code %s)\n' "$status"
  pause_if_terminal
fi
exit "$status"
