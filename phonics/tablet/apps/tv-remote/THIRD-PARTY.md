# Third-party code in tablet/apps/tv-remote

- `helper/vendor/androidtvremote2/` — **androidtvremote2 0.3.2** by tronikos, Apache-2.0 (LICENSE alongside).
  https://github.com/tronikos/androidtvremote2 — the Android TV Remote protocol v2 (pairing on :6467, commands on :6466),
  vendored unchanged because the tablet image has no pip (PEP 668, no ensurepip). It needs the Debian packages
  `python3-cryptography`, `python3-aiofiles` and `python3-protobuf` (>= 3.20), which `helper/install.sh` installs with apt.
