#!/bin/zsh
# Install check: does the zip a judge receives start from nothing but itself?
#
# Packs the last commit with scripts/pack.js (or takes a zip), unzips it into a
# fresh temp folder whose path has a space, starts YAP by running
# "Start YAP.command" itself with YAP_NO_OPEN=1, waits for HTTP 200 on / ,
# starts it a second time to see the install and the server reused, stops it
# with "Stop YAP.command" and removes the temp folder. No browser, no model.
#
# Same Mac: this does not prove a different machine, and it does not show the
# warning macOS gives a file downloaded through a browser.
#
#   zsh scripts/install-check.sh [zip]
#   PORT=<n>     the first port the launcher tries (default 4555; it takes the next free one)
#   NO_NODE=1    start with a PATH that has no Node, so the launcher fetches its pinned copy
#   KEEP=1       keep the temp folder (its path is printed)
#
# Prints one PASS or FAIL line per step. Exits 0 only when every step passed.

src=${0:A:h:h}
PORT=${PORT:-4555}
bad=0
pass() { print "PASS $1" }
fail() { print "FAIL $1"; bad=$((bad + 1)) }

tmp=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/yap-install-check.XXXXXX") || { print "FAIL temp folder: mktemp failed"; exit 1 }
app="$tmp/fresh copy/YAP"
bare_path=/usr/bin:/bin:/usr/sbin:/sbin

# The launcher as a judge's double-click runs it: the file itself, not `zsh file`.
launch() {
  if [[ -n "$NO_NODE" ]]; then
    /usr/bin/env -i HOME="$HOME" PATH=$bare_path YAP_NO_OPEN=1 YAP_PORT=$PORT "$app/$1"
  else
    YAP_NO_OPEN=1 YAP_PORT=$PORT "$app/$1"
  fi
}

finish() {
  # Whatever happened above, leave no server and no temp folder behind.
  [[ -r "$app/data/server.pid" ]] && launch "Stop YAP.command" > /dev/null 2>&1
  if [[ -n "$KEEP" ]]; then print "kept $tmp"; else /bin/rm -rf "$tmp"; fi
  [[ -z "$KEEP" && -e "$tmp" ]] && fail "cleanup: $tmp is still there"
  if (( bad )); then print "INSTALL CHECK FAIL ($bad)"; exit 1; fi
  print "INSTALL CHECK PASS"
  exit 0
}
give_up() { fail "$1"; finish }
trap 'give_up "interrupted"' INT TERM

if [[ -n "$NO_NODE" ]] && PATH=$bare_path whence -p node > /dev/null; then
  give_up "NO_NODE=1: $bare_path has a Node, so the fetch would not run"
fi

zip=$1
if [[ -z "$zip" ]]; then
  zip="$tmp/YAP.zip"
  node "$src/scripts/pack.js" --out "$zip" > "$tmp/pack.log" 2>&1 || give_up "pack: $(/usr/bin/tail -3 "$tmp/pack.log" | /usr/bin/tr '\n' ' ')"
fi
[[ -r "$zip" ]] || give_up "zip: $zip cannot be read"
pass "zip: $(/usr/bin/stat -f %z "$zip") bytes, $(/usr/bin/unzip -Z1 "$zip" | /usr/bin/grep -vc '/$') files"

/bin/mkdir "$tmp/fresh copy" && /usr/bin/unzip -q "$zip" -d "$tmp/fresh copy" || give_up "unzip: failed"
if [[ "$(/bin/ls "$tmp/fresh copy")" == YAP && -d "$app" ]]; then pass "unzip: one folder named YAP"; else give_up "unzip: expected one folder named YAP, got: $(/bin/ls "$tmp/fresh copy")"; fi

for f in "Start YAP.command" "Stop YAP.command"; do
  if [[ -x "$app/$f" ]]; then pass "executable bit: $f"; else fail "executable bit: $f lost it, so a double-click cannot run it"; fi
done
[[ -f "$app/README.md" ]] && pass "judge guide: README.md, $(/usr/bin/wc -l < "$app/README.md" | /usr/bin/tr -d ' ') lines" || fail "judge guide: README.md is missing"
[[ -e "$app/test/take-run.test.js" ]] && fail "development tests are in the zip" || pass "development tests stay out"
(( bad )) && finish

t=$SECONDS
launch "Start YAP.command" > "$tmp/start.log" 2>&1; rc=$?
if (( rc == 0 )); then
  pass "first start: exit 0 in $((SECONDS - t)) s, $(/usr/bin/wc -l < "$tmp/start.log" | /usr/bin/tr -d ' ') lines printed"
else
  fail "first start: exit $rc"
  /usr/bin/sed 's/^/  | /' "$tmp/start.log"
  [[ -r "$app/data/setup.log" ]] && /usr/bin/tail -15 "$app/data/setup.log" | /usr/bin/sed 's/^/  setup.log | /'
  finish
fi

if [[ -n "$NO_NODE" ]]; then
  own=("$app"/data/node/node-v*/bin/node(N))
  if (( $#own == 1 )) && /usr/bin/grep -q "Nothing is installed on your Mac" "$tmp/start.log"; then
    pass "no Node on PATH: fetched $("$own[1]" --version) into data/node, SHA-256 matched"
  else
    fail "no Node on PATH: expected one fetched copy in data/node"
  fi
fi

url=$(/usr/bin/sed -n 's/^YAP is running at //p' "$tmp/start.log")
pid=$(<"$app/data/server.pid") 2>/dev/null
code=000
for i in {1..30}; do
  code=$(/usr/bin/curl -s -m 5 -o /dev/null -w '%{http_code}' "$url")
  [[ "$code" == 200 ]] && break
  /bin/sleep 1
done
if [[ "$code" == 200 ]]; then pass "front door: HTTP 200 on $url"; else fail "front door: HTTP $code on $url"; fi

# A second start must reuse the install and the running server.
before=$(/usr/bin/stat -f %m "$app/data/install.json" 2>/dev/null)
t=$SECONDS
launch "Start YAP.command" > "$tmp/start2.log" 2>&1; rc=$?
after=$(/usr/bin/stat -f %m "$app/data/install.json" 2>/dev/null)
lines=$(/usr/bin/wc -l < "$tmp/start2.log" | /usr/bin/tr -d ' ')
if (( rc == 0 )) && [[ -n "$before" && "$before" == "$after" && "$(<"$app/data/server.pid")" == "$pid" && "$lines" == 3 ]]; then
  pass "second start: reused the install and server $pid in $((SECONDS - t)) s, 3 lines printed"
else
  fail "second start: exit $rc, $lines lines, install receipt $before -> $after, server $pid -> $(<"$app/data/server.pid")"
  /usr/bin/sed 's/^/  | /' "$tmp/start2.log"
fi

launch "Stop YAP.command" > "$tmp/stop.log" 2>&1; rc=$?
for i in {1..10}; do kill -0 "$pid" 2>/dev/null || break; /bin/sleep 0.5; done
if (( rc == 0 )) && ! kill -0 "$pid" 2>/dev/null && ! /usr/bin/curl -s -m 2 -o /dev/null "$url"; then
  pass "stop: $(<"$tmp/stop.log")"
else
  fail "stop: exit $rc, process $pid $(kill -0 "$pid" 2>/dev/null && print alive || print gone): $(<"$tmp/stop.log")"
fi

finish
