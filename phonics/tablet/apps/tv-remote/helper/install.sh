#!/usr/bin/env bash
# install.sh — one-time setup of the TV Remote helper on the tablet (PLAN.md §14, D-046). Run ON the tablet, once, by a grown-up:
#
#   ssh -t arduino@PPQ.local 'bash ~/kids-tablet/bundle/apps/tv-remote/helper/install.sh'
#
# 1. the three Debian packages the vendored androidtvremote2 library needs (the image has no pip)   — asks for sudo
# 2. a user service that keeps the helper running on 127.0.0.1:8097 (code lives in the bundle, state in ~/kids-tablet/state/tv-remote)
# After a push.sh that changes the helper:  systemctl --user restart tvremote.service
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
echo "== Debian packages for the Android TV Remote library (python3-cryptography, python3-aiofiles, python3-protobuf)"
sudo apt-get install -y --no-install-recommends python3-cryptography python3-aiofiles python3-protobuf
python3 -c "import sys; sys.path.insert(0, '$HERE/vendor'); import androidtvremote2; print('   library imports: ok')"
echo "== user service tvremote.service (127.0.0.1:8097)"
mkdir -p "$HOME/.config/systemd/user" "$HOME/kids-tablet/state/tv-remote"
install -m 644 "$HERE/tvremote.service" "$HOME/.config/systemd/user/tvremote.service"
systemctl --user daemon-reload
systemctl --user enable tvremote.service
systemctl --user restart tvremote.service   # (re)start so a helper already running picks the packages up
sleep 1.5
systemctl --user --no-pager --lines=3 status tvremote.service || true
curl -fsS 127.0.0.1:8097/status && echo
echo "Done. On the tablet: TV Remote tile → hold the ⚙ corner → pick the TV (or type its address) → type the code the TV shows."
