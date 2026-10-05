#!/bin/zsh
# Start YAP: double-click this file.
#
# It finds Node 18 or newer on this Mac, runs scripts/setup.js (which installs
# only inside this folder on the first start and reuses that install after) and
# opens YAP in the browser. When the Mac has no usable Node, it fetches the
# official Node build from nodejs.org into data/node inside this folder, checks
# it against the SHA-256 pinned below and uses that copy. Nothing is installed
# on the Mac, no administrator password is asked for and no other program is
# stopped.
#
#   "Start YAP.command" --stop   stop the server this folder started (Stop YAP.command)
#   YAP_NO_OPEN=1                start without opening a browser
#   YAP_PORT=<n>                 the first port to try (default 4317)

cd "${0:A:h}" || exit 1

# The Node LTS this launcher fetches, with the checksums nodejs.org publishes
# for it in https://nodejs.org/dist/v24.21.0/SHASUMS256.txt (read 4 Oct 2026).
NODE_VERSION=v24.21.0
NODE_SHA_ARM64=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057
NODE_SHA_X64=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097
NODE_DIST=${YAP_NODE_DIST:-https://nodejs.org/dist}

# An Apple-silicon Mac reports arm64 here even when this shell runs under Rosetta.
if [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null)" == 1 ]]; then
  node_name=node-$NODE_VERSION-darwin-arm64; node_sha=$NODE_SHA_ARM64
else
  node_name=node-$NODE_VERSION-darwin-x64; node_sha=$NODE_SHA_X64
fi
own_node=$PWD/data/node/$node_name/bin/node

node_ok() {
  [[ -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null
}

# The Mac's own Node first, then the copy an earlier start fetched.
find_node() {
  local found
  for found in "$(whence -p node)" "$own_node"; do
    if node_ok "$found"; then NODE=$found; return 0; fi
  done
  return 1
}

fetch_node() {
  local dir=$PWD/data/node
  local part=$dir/$node_name.tar.gz.part unpack=$dir/unpack.part
  print "Fetching Node $NODE_VERSION from nodejs.org into this folder (about 50 MB). Nothing is installed on your Mac."
  # Start clean: an earlier start may have stopped halfway.
  /bin/mkdir -p "$dir" && /bin/rm -rf "$part" "$unpack" "$dir/$node_name"
  if ! /usr/bin/curl -fsL --retry 2 --max-time 900 -o "$part" "$NODE_DIST/$NODE_VERSION/$node_name.tar.gz"; then
    /bin/rm -rf "$part"
    print "The download from nodejs.org did not finish. Check the internet connection, then start YAP again."
    return 1
  fi
  if [[ "$(/usr/bin/shasum -a 256 "$part" | /usr/bin/cut -d ' ' -f 1)" != "$node_sha" ]]; then
    /bin/rm -rf "$part"
    print "The Node download did not match its pinned SHA-256, so YAP removed it and started nothing. Start YAP again to retry."
    return 1
  fi
  if ! { /bin/mkdir -p "$unpack" && /usr/bin/tar -xzf "$part" -C "$unpack" && /bin/mv "$unpack/$node_name" "$dir/$node_name" }; then
    /bin/rm -rf "$part" "$unpack" "$dir/$node_name"
    print "The Node download could not be unpacked in this folder. Check that the disk has space, then start YAP again."
    return 1
  fi
  /bin/rm -rf "$part" "$unpack"
  if ! node_ok "$own_node"; then
    print "Node $NODE_VERSION did not run on this Mac. It needs macOS 13.5 or newer."
    return 1
  fi
  NODE=$own_node
}

if [[ "$1" == --stop ]]; then
  if ! find_node; then
    print "Node was not found on this Mac or in this folder, so nothing was stopped."
    exit 1
  fi
  export PATH="${NODE:h}:$PATH"
  "$NODE" scripts/setup.js --stop
  exit $?
fi

find_node || fetch_node || exit 1
# npm starts through "env node": put the chosen Node first on PATH.
export PATH="${NODE:h}:$PATH"

setup_args=(--launcher)
[[ "$YAP_NO_OPEN" == 1 ]] && setup_args+=(--no-open)
"$NODE" scripts/setup.js $setup_args || exit $?

# Opened by a double-click, the window stays until YAP stops. Closing it leaves YAP running.
if [[ -t 1 && -r data/server.pid ]]; then
  server_pid=$(<data/server.pid)
  while kill -0 "$server_pid" 2>/dev/null; do /bin/sleep 2; done
  print "YAP has stopped."
fi
