#!/usr/bin/env python3
"""tvremote.py — the tablet's TV helper: talks the Android TV Remote protocol v2 to the family's Google TV
(Hisense, PLAN.md §14, D-046) and offers it to the TV Remote tile as a tiny JSON service on 127.0.0.1:8097 ONLY.

    python3 tvremote.py --port 8097 --state ~/kids-tablet/state/tv-remote
    python3 tvremote.py --fake --port 8097 --state /tmp/x        # laptop/test: a pretend TV, pairing code 123456

The tile is served by the launcher (127.0.0.1:8090) and fetches this helper from localhost — the kiosk's URL blocklist
blocks navigation, not a page's fetches (same as the camera helper on :8095). The helper is the ONLY part of the tablet
that opens a connection to another device on the home LAN; it connects to exactly one host, the TV a grown-up paired,
and refuses anything that is not a private (RFC 1918) address.

Protocol (vendored library `vendor/androidtvremote2`, Apache-2.0): TLS to the TV with a self-signed client cert kept in
the state dir. First time: POST /pair/start {host} → the TV shows a 6-character hex code → POST /pair/finish {code} → the TV
remembers our cert → from then on the helper connects at start and keeps reconnecting by itself.

Routes (all JSON, CORS *, 127.0.0.1 only):
  GET  /status            {phase, host, name, is_on, current_app, volume:{level,max,muted}, error, fake}
                          phase: nolib | unpaired | pairing | pair_failed | connecting | ready | lost
  GET  /discover          [{name, host, port}] — Google TVs on the LAN (one-shot mDNS query for _androidtvremote2._tcp)
  POST /pair/start        {host, name?} → the TV shows a code; phase → pairing
  POST /pair/finish       {code} → paired + connected, or pair_failed (wrong code) / unpaired (cancelled on the TV)
  POST /pair/cancel
  POST /forget            {host?} drop one TV's pairing (the active one by default; the cert goes with the last TV)
  POST /tv/select         {host} steer another paired TV — tvs.json remembers every paired TV and the active one
  POST /key               {key: "DPAD_UP", direction?: "SHORT"|"START_LONG"|"END_LONG"} — kid-safe allowlist below
  POST /app               {id: "org.pbskids.video" | "https://…"} → launch on the TV (package → launcher intent, https as-is)
  GET  /fake/log          (--fake only) what the pretend TV received, for tests

No ping, no telemetry, nothing leaves the tablet except the TV connection above.
"""
from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import re
import logging
import os
import random
import socket
import struct
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor"))

LOG = logging.getLogger("tvremote")

# The library's three exceptions, or stand-ins when the library cannot load (missing Debian packages) and in --fake mode.
LIB_ERR = ""
try:
    from androidtvremote2 import CannotConnect, ConnectionClosed, InvalidAuth  # noqa: E402
except Exception as _e:  # noqa: BLE001
    LIB_ERR = f"{type(_e).__name__}: {_e}"

    class CannotConnect(Exception):
        pass

    class ConnectionClosed(Exception):
        pass

    class InvalidAuth(Exception):
        pass

# Keys a child may send. Everything that could lose the picture or reach the TV's own settings stays out
# (inputs, settings, channel, numbers). POWER is in: the tile puts it behind a hold.
ALLOWED_KEYS = {
    "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_CENTER", "ENTER",
    "HOME", "BACK",
    "VOLUME_UP", "VOLUME_DOWN", "MUTE", "VOLUME_MUTE",
    "MEDIA_PLAY_PAUSE", "MEDIA_PLAY", "MEDIA_PAUSE", "MEDIA_NEXT", "MEDIA_PREVIOUS", "MEDIA_REWIND", "MEDIA_FAST_FORWARD",
    "POWER",
}
DIRECTIONS = {"SHORT", "START_LONG", "END_LONG"}
MDNS_SERVICE = "_androidtvremote2._tcp.local."


def private_host(host: str) -> bool:
    """Only a home-LAN address may be a TV."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private and not ip.is_loopback and not ip.is_link_local and not ip.is_multicast


# ---------------------------------------------------------------- mDNS (one shot, pure python: the tablet has no avahi)
def _dns_name(qname: str) -> bytes:
    out = b""
    for part in qname.strip(".").split("."):
        b = part.encode("utf-8")
        out += bytes([len(b)]) + b
    return out + b"\x00"


def _read_name(msg: bytes, off: int, depth: int = 0):
    labels = []
    while True:
        if off >= len(msg) or depth > 20:
            return ".".join(labels), off
        n = msg[off]
        if n == 0:
            return ".".join(labels), off + 1
        if n & 0xC0 == 0xC0:
            ptr = struct.unpack("!H", msg[off:off + 2])[0] & 0x3FFF
            name, _ = _read_name(msg, ptr, depth + 1)
            labels.append(name)
            return ".".join(labels), off + 2
        off += 1
        labels.append(msg[off:off + n].decode("utf-8", "replace"))
        off += n


def mdns_discover(service: str = MDNS_SERVICE, wait: float = 2.5) -> list[dict]:
    """Ask the LAN once for the Google TVs that advertise the remote service; returns [{name, host, port}]."""
    q = struct.pack("!HHHHHH", 0, 0, 1, 0, 0, 0) + _dns_name(service) + struct.pack("!HH", 12, 0x8001)  # PTR, QU bit
    socks = []
    s1 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s1.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s1.settimeout(0.3)
    s1.bind(("", 0))
    socks.append(s1)
    # also listen on 5353 for responders that answer by multicast only (shared with avahi where it exists)
    try:
        s2 = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        s2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            s2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        s2.bind(("", 5353))
        s2.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton("224.0.0.251") + socket.inet_aton("0.0.0.0"))
        s2.settimeout(0.3)
        socks.append(s2)
    except OSError:
        pass
    ptr, srv, a = {}, {}, {}   # instance -> service ; instance -> (port, target) ; target -> ip
    try:
        for _ in range(2):
            try:
                s1.sendto(q, ("224.0.0.251", 5353))
            except OSError:
                pass
            t0 = time.time()
            while time.time() - t0 < wait / 2:
                for s in socks:
                    try:
                        msg, _addr = s.recvfrom(4096)
                    except (socket.timeout, OSError):
                        continue
                    try:
                        _parse(msg, ptr, srv, a, service)
                    except Exception:  # noqa: BLE001 — a malformed packet from the LAN is not our problem
                        pass
    finally:
        for s in socks:
            s.close()
    out, seen = [], set()
    for inst in ptr:
        port, target = srv.get(inst, (6466, None))
        ip = a.get(target or "")
        if not ip or ip in seen:
            continue
        seen.add(ip)
        name = inst[: -len(service)].rstrip(".") if inst.endswith(service) else inst
        out.append({"name": name or ip, "host": ip, "port": port})
    out.sort(key=lambda d: d["name"].lower())
    return out


def _parse(msg, ptr, srv, a, service):
    _id, flags, qd, an, ns, ar = struct.unpack("!HHHHHH", msg[:12])
    if not flags & 0x8000:
        return
    off = 12
    for _ in range(qd):
        _, off = _read_name(msg, off)
        off += 4
    for _ in range(an + ns + ar):
        name, off = _read_name(msg, off)
        rtype, _rclass, _ttl, rdlen = struct.unpack("!HHIH", msg[off:off + 10])
        off += 10
        rd = msg[off:off + rdlen]
        if rtype == 12 and name.lower() == service.lower():            # PTR
            inst, _ = _read_name(msg, off)
            ptr[inst] = True
        elif rtype == 33:                                              # SRV
            _pri, _wt, port = struct.unpack("!HHH", rd[:6])
            target, _ = _read_name(msg, off + 6)
            srv[name] = (port, target)
        elif rtype == 1 and rdlen == 4:                                # A
            a[name] = socket.inet_ntoa(rd)
        off += rdlen


# ---------------------------------------------------------------- the TV (real library, or a pretend one for tests)
class FakeRemote:
    """Same surface as androidtvremote2.AndroidTVRemote, for the laptop and the DOM test. Pairing code is 123456."""
    PIN = "123456"

    def __init__(self, host, store):
        self.host = host
        self.store = store                   # dict shared with the helper: paired flag + log
        self.is_on = True
        self.current_app = "com.google.android.tvlauncher"
        self.volume_info = {"level": 7, "max": 15, "muted": False}
        self.device_info = {"manufacturer": "Pretend", "model": "TV"}
        self._connected = False
        self._pairing = False

    async def async_generate_cert_if_missing(self):
        return False

    async def async_connect(self):
        if self.host == "10.0.0.98":
            raise CannotConnect("pretend TV is off")
        if not self.store["paired"].get(self.host):
            raise InvalidAuth("not paired")
        self._connected = True

    def keep_reconnecting(self, cb=None):
        pass

    def disconnect(self):
        self._connected = False
        self._pairing = False

    async def async_start_pairing(self):
        if self.host == "10.0.0.98":
            raise CannotConnect("pretend TV is off")
        self._pairing = True
        self.store["log"].append("pairing_shown")

    async def async_finish_pairing(self, code):
        if not self._pairing:
            raise ConnectionClosed("cancelled")
        self._pairing = False
        if code != self.PIN:
            raise InvalidAuth("wrong code")
        self.store["paired"][self.host] = True

    def send_key_command(self, key, direction="SHORT"):
        if not self._connected:
            raise ConnectionClosed("not connected")
        self.store["log"].append(f"key:{key}:{direction}")
        if key == "POWER":
            self.is_on = not self.is_on
        elif key == "VOLUME_UP":
            self.volume_info["level"] = min(self.volume_info["max"], self.volume_info["level"] + 1)
        elif key == "VOLUME_DOWN":
            self.volume_info["level"] = max(0, self.volume_info["level"] - 1)
        elif key in ("MUTE", "VOLUME_MUTE"):
            self.volume_info["muted"] = not self.volume_info["muted"]
        elif key == "HOME":
            self.current_app = "com.google.android.tvlauncher"

    def send_launch_app_command(self, link):
        if not self._connected:
            raise ConnectionClosed("not connected")
        self.store["log"].append(f"app:{link}")
        m = re.search(r"package=([\w.]+);", link)
        self.current_app = m.group(1) if m else link


class TV:
    """Owns the asyncio loop (own thread), the remote object and the little state machine the tile reads."""

    def __init__(self, state_dir: Path, fake: bool):
        self.state_dir = state_dir
        self.fake = fake
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.certfile = str(self.state_dir / "cert.pem")
        self.keyfile = str(self.state_dir / "key.pem")
        self.cfg_path = self.state_dir / "tvs.json"      # {"active": host, "tvs": {host: {"name", "fake_paired"}}}
        self.tvs = {}
        self.cfg = self._load_cfg()                       # the ACTIVE TV as {"host", "name"} ({} = none)
        self.phase = "unpaired"
        self.error = ""
        self.remote = None
        self.lib_ok = True
        self.fake_store = {"paired": {h: True for h, t in self.tvs.items() if t.get("fake_paired")}, "log": []}
        self.loop = asyncio.new_event_loop()
        self._task = None
        if not fake and LIB_ERR:
            self.lib_ok = False
            self.phase = "nolib"
            self.error = LIB_ERR
            LOG.error("remote library not usable: %s", self.error)
        threading.Thread(target=self.loop.run_forever, name="tv-loop", daemon=True).start()
        if self.lib_ok and self.cfg.get("host"):
            self.call(self._start_connect())

    # -- plumbing
    def call(self, coro, timeout=20):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout)

    def _load_cfg(self):
        """tvs.json -> self.tvs; returns the active TV as {"host","name"} ({} = none). Migrates the one-TV tv.json (2026-11-02)."""
        d = {}
        try:
            d = json.loads(self.cfg_path.read_text())
        except Exception:  # noqa: BLE001
            old = self.state_dir / "tv.json"
            try:
                o = json.loads(old.read_text())
                if o.get("host"):
                    d = {"active": o["host"], "tvs": {o["host"]: {"name": o.get("name") or o["host"], "fake_paired": bool(o.get("fake_paired"))}}}
                    self.cfg_path.write_text(json.dumps(d, indent=1))
                    old.unlink()
                    LOG.info("migrated tv.json -> tvs.json (%s)", o["host"])
            except Exception:  # noqa: BLE001
                pass
        self.tvs = {h: t for h, t in (d.get("tvs") or {}).items() if isinstance(t, dict) and t.get("name")}
        active = d.get("active") if d.get("active") in self.tvs else (next(iter(self.tvs)) if self.tvs else None)
        return {"host": active, "name": self.tvs[active]["name"]} if active else {}

    def _save_cfg(self):
        self.cfg_path.write_text(json.dumps({"active": self.cfg.get("host"), "tvs": self.tvs}, indent=1))

    async def _learn_name(self, host):
        """Names: the one the TV announces on the network (mDNS, what the grown-up sees in the list) is best and final;
        a TV paired by typed address starts as its address and gets the device label (manufacturer + model) until mDNS
        answers for it — two Chromecasts must not both read "Google Chromecast" on the picker."""
        t = self.tvs.get(host)
        if not t or t.get("name_src") == "mdns":
            return
        found = {}
        if not self.fake:
            try:
                found = {d["host"]: d["name"] for d in await self.loop.run_in_executor(None, mdns_discover) if d.get("name")}
            except Exception:  # noqa: BLE001
                found = {}
        label, src = found.get(host), "mdns"
        if not label:
            if t.get("name") not in (None, "", host):
                return                        # keep the list name / device label; mDNS is tried again at the next connect
            try:
                di = self.remote.device_info or {}
                label = " ".join(str(di.get(k) or "").strip() for k in ("manufacturer", "model")).strip()
            except Exception:  # noqa: BLE001
                label = ""
            src = "device"
        if label:
            t["name"], t["name_src"] = label[:40], src
            if self.cfg.get("host") == host:
                self.cfg["name"] = t["name"]
            self._save_cfg()

    def _make_remote(self, host):
        if self.fake:
            return FakeRemote(host, self.fake_store)
        from androidtvremote2 import AndroidTVRemote
        r = AndroidTVRemote("Kids Tablet", self.certfile, self.keyfile, host, loop=self.loop, enable_ime=True)
        r.add_is_available_updated_callback(self._available)
        return r

    def _available(self, ok: bool):
        if self.phase in ("ready", "lost"):
            self.phase = "ready" if ok else "lost"

    # -- status for the tile
    def status(self):
        r = self.remote
        vol = None
        try:
            vi = r.volume_info if r else None
            if vi:
                vol = {"level": vi.get("level"), "max": vi.get("max"), "muted": vi.get("muted")}
        except Exception:  # noqa: BLE001
            pass
        return {
            "phase": self.phase, "host": self.cfg.get("host"), "name": self.cfg.get("name"),
            "is_on": (r.is_on if r and self.phase == "ready" else None),
            "current_app": (r.current_app if r and self.phase == "ready" else None),
            "volume": vol if self.phase == "ready" else None,
            "error": self.error, "fake": self.fake, "paired": bool(self.tvs),
            "tvs": [{"host": h, "name": t.get("name") or h, "active": h == self.cfg.get("host")} for h, t in self.tvs.items()],
        }

    # -- connecting (after a pairing, and at every start)
    async def _start_connect(self):
        if self._task:
            self._task.cancel()
        self._task = self.loop.create_task(self._connect_loop())

    async def _connect_loop(self):
        host = self.cfg.get("host")
        if not host:
            self.phase = "unpaired"
            return
        if self.remote:
            try:
                self.remote.disconnect()
            except Exception:  # noqa: BLE001
                pass
        self.remote = self._make_remote(host)
        await self.remote.async_generate_cert_if_missing()
        delay = 3
        while True:
            self.phase = "connecting"
            try:
                await self.remote.async_connect()
                self.remote.keep_reconnecting(self._invalid_auth)
                self.phase, self.error = "ready", ""
                LOG.info("connected to %s", host)
                await self._learn_name(host)
                return
            except InvalidAuth:
                self.phase, self.error = "unpaired", "The TV does not know this tablet yet — pair it again."
                LOG.warning("TV %s rejected our certificate: pairing needed", host)
                return
            except (CannotConnect, ConnectionClosed, OSError) as e:
                self.phase, self.error = "lost", f"TV not reachable ({type(e).__name__})"
                await asyncio.sleep(delay)
                delay = min(30, delay * 2)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.phase, self.error = "lost", f"{type(e).__name__}: {e}"
                LOG.error("connect: %s", traceback.format_exc())
                await asyncio.sleep(10)

    def _invalid_auth(self):
        self.phase, self.error = "unpaired", "The TV forgot this tablet — pair it again."

    # -- pairing
    async def _pair_start(self, host, name):
        if self._task:
            self._task.cancel()
            self._task = None
        if self.remote:
            try:
                self.remote.disconnect()
            except Exception:  # noqa: BLE001
                pass
        prev = dict(self.cfg)
        self.remote = self._make_remote(host)
        self.cfg = {"host": host, "name": name or (self.tvs.get(host) or {}).get("name") or host}
        self.error = ""
        try:
            await self.remote.async_generate_cert_if_missing()
            await self.remote.async_start_pairing()
            self.phase = "pairing"
        except (CannotConnect, ConnectionClosed, OSError) as e:
            self.phase, self.error = "pair_failed", f"Could not reach the TV at {host} ({type(e).__name__}). Is it on?"
            self.cfg = prev if prev.get("host") in self.tvs else {}
            if self.cfg:
                await self._start_connect()   # back to the TV we were steering; the panel already shows the message
        return self.status()

    async def _pair_finish(self, code):
        if self.phase != "pairing" or not self.remote:
            self.error = "Start pairing first."
            return self.status()
        try:
            await self.remote.async_finish_pairing(code)
        except InvalidAuth:
            self.phase, self.error = "pair_failed", "That was not the code on the TV. Try again."
            return self.status()
        except (ConnectionClosed, OSError) as e:
            self.phase, self.error = "pair_failed", f"The TV stopped the pairing ({type(e).__name__})."
            return self.status()
        host = self.cfg["host"]
        self.tvs[host] = {"name": self.cfg.get("name") or host, "fake_paired": self.fake,
                          "name_src": "mdns" if self.cfg.get("name") not in (None, "", host) else "typed"}
        if self.fake:
            self.fake_store["paired"][host] = True
        self._save_cfg()
        self.error = ""
        self.phase = "connecting"
        await self._start_connect()
        await asyncio.sleep(0.3)
        return self.status()

    async def _pair_cancel(self):
        if self.remote:
            try:
                self.remote.disconnect()
            except Exception:  # noqa: BLE001
                pass
        if self.tvs:
            self.cfg = self._load_cfg()      # back to the saved active TV
            await self._start_connect()
        else:
            self.cfg, self.phase = {}, "unpaired"
        return self.status()

    async def _forget(self, host=None):
        host = host or self.cfg.get("host")
        self.tvs.pop(host, None)
        self.fake_store["paired"].pop(host, None)
        if host and host != self.cfg.get("host"):
            self._save_cfg()                 # a TV we were not steering: nothing to disconnect
            return self.status()
        if self._task:
            self._task.cancel()
            self._task = None
        if self.remote:
            try:
                self.remote.disconnect()
            except Exception:  # noqa: BLE001
                pass
        self.remote = None
        if self.tvs:                          # another paired TV takes over
            nxt = next(iter(self.tvs))
            self.cfg, self.error = {"host": nxt, "name": self.tvs[nxt].get("name") or nxt}, ""
            self._save_cfg()
            await self._start_connect()
            await asyncio.sleep(0.3)
            return self.status()
        for p in (self.cfg_path, Path(self.certfile), Path(self.keyfile)):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
        self.cfg, self.phase, self.error = {}, "unpaired", ""
        return self.status()

    async def _select(self, host):
        """Steer another TV that is already paired (the kid-side picker); no code needed."""
        if host not in self.tvs:
            return {**self.status(), "ok": False, "error": "That TV is not paired yet - a grown-up pairs it first."}
        if host == self.cfg.get("host") and self.phase == "ready":
            return self.status()
        self.cfg, self.error = {"host": host, "name": self.tvs[host].get("name") or host}, ""
        self._save_cfg()
        await self._start_connect()
        await asyncio.sleep(0.3)
        return self.status()

    # -- commands
    async def _key(self, key, direction):
        if self.phase != "ready" or not self.remote:
            return {"ok": False, "error": "TV not connected", "phase": self.phase}
        try:
            self.remote.send_key_command(key, direction)
        except ConnectionClosed:
            self.phase = "lost"
            return {"ok": False, "error": "TV connection lost", "phase": self.phase}
        return {"ok": True}

    async def _app(self, link):
        if self.phase != "ready" or not self.remote:
            return {"ok": False, "error": "TV not connected", "phase": self.phase}
        try:
            self.remote.send_launch_app_command(link)
        except ConnectionClosed:
            self.phase = "lost"
            return {"ok": False, "error": "TV connection lost", "phase": self.phase}
        return {"ok": True}


# ---------------------------------------------------------------- HTTP
def serve(tv: TV, port: int, agent_url: str = ""):
    disc_cache = {"t": 0.0, "list": []}

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def _send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-KT-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self._send(204, {})

        def _check_perm(self, body=None) -> bool:
            if not agent_url:
                return True
            import urllib.error, urllib.parse, urllib.request
            qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            tok = (qs.get("token") or [""])[0] or (self.headers.get("X-KT-Token") or "") or ((body or {}).get("token") or "")
            if not tok:
                self._send(403, {"ok": False, "error": "permission denied: tv (missing token)"})
                return False
            url = f"{agent_url.rstrip('/')}/api/permissions/check?resource=tv&token={urllib.parse.quote(str(tok))}"
            try:
                with urllib.request.urlopen(url, timeout=2.0) as r:
                    data = json.loads(r.read().decode("utf-8") or "{}")
                    if r.status == 200 and data.get("granted"):
                        return True
            except (urllib.error.URLError, OSError, ValueError):
                pass
            self._send(403, {"ok": False, "error": "permission denied: tv"})
            return False

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            try:
                return json.loads(self.rfile.read(min(n, 4096)) or b"{}")
            except ValueError:
                return {}

        def do_GET(self):
            p = self.path.split("?")[0]
            if p in ("/status", "/discover"):
                if not self._check_perm():
                    return
            if p == "/status":
                return self._send(200, tv.status())
            if p == "/discover":
                if time.time() - disc_cache["t"] > 8:
                    if tv.fake:
                        disc_cache["list"] = [{"name": "Pretend TV", "host": "10.0.0.99", "port": 6466},
                                              {"name": "Sleeping TV", "host": "10.0.0.98", "port": 6466},
                                              {"name": "Pretend TV 2", "host": "10.0.0.97", "port": 6466}]
                    else:
                        try:
                            disc_cache["list"] = mdns_discover()
                        except Exception as e:  # noqa: BLE001
                            LOG.warning("discover: %s", e)
                            disc_cache["list"] = []
                    disc_cache["t"] = time.time()
                return self._send(200, disc_cache["list"])
            if p == "/fake/log" and tv.fake:
                return self._send(200, {"log": tv.fake_store["log"], "paired": bool(tv.fake_store["paired"])})
            self._send(404, {"error": "no such route"})

        def do_POST(self):
            p = self.path.split("?")[0]
            b = self._body()
            if not self._check_perm(b):
                return
            try:
                if p == "/pair/start":
                    host = str(b.get("host", "")).strip()
                    if not private_host(host):
                        return self._send(400, {"error": "that is not an address on this home network", "phase": tv.phase})
                    if not tv.lib_ok:
                        return self._send(503, tv.status())
                    return self._send(200, tv.call(tv._pair_start(host, str(b.get("name", ""))[:60])))
                if p == "/pair/finish":
                    code = "".join(ch for ch in str(b.get("code", "")).upper() if ch in "0123456789ABCDEF")  # hex, as the TV shows it
                    if len(code) != 6:
                        return self._send(400, {"error": "the code is 6 characters (0-9, A-F)", "phase": tv.phase})
                    return self._send(200, tv.call(tv._pair_finish(code), timeout=30))
                if p == "/pair/cancel":
                    return self._send(200, tv.call(tv._pair_cancel()))
                if p == "/forget":
                    return self._send(200, tv.call(tv._forget(str(b.get("host", "")).strip() or None)))
                if p == "/tv/select":
                    host = str(b.get("host", "")).strip()
                    if not private_host(host):
                        return self._send(400, {"error": "that is not an address on this home network", "phase": tv.phase})
                    return self._send(200, tv.call(tv._select(host)))
                if p == "/key":
                    key = str(b.get("key", "")).upper().replace("KEYCODE_", "")
                    direction = str(b.get("direction", "SHORT")).upper()
                    if key not in ALLOWED_KEYS or direction not in DIRECTIONS:
                        return self._send(400, {"ok": False, "error": f"key {key!r} is not on the kids' remote"})
                    return self._send(200, tv.call(tv._key(key, direction), timeout=5))
                if p == "/app":
                    link = str(b.get("id", "")).strip()
                    is_pkg = link.replace(".", "").replace("_", "").isalnum() and "." in link
                    if not (link.startswith("https://") or is_pkg) or len(link) > 200:
                        return self._send(400, {"ok": False, "error": "not an app id or https link"})
                    if is_pkg:
                        # Joe's Google TV answers an error to market://launch?id=<pkg> (the library's default for a bare
                        # id); an explicit launcher intent for the package is what the TV's own launcher sends. Only this
                        # exact shape is ever built here - the tile cannot pass a raw intent URI.
                        link = ("intent:#Intent;action=android.intent.action.MAIN;"
                                f"category=android.intent.category.LEANBACK_LAUNCHER;package={link};end")
                    return self._send(200, tv.call(tv._app(link), timeout=5))
            except Exception as e:  # noqa: BLE001
                LOG.error("%s: %s", p, traceback.format_exc())
                return self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}", "phase": tv.phase})
            self._send(404, {"error": "no such route"})

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    srv.daemon_threads = True
    LOG.info("tv helper on 127.0.0.1:%d state=%s fake=%s", port, tv.state_dir, tv.fake)
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=8097)
    ap.add_argument("--state", default=os.path.expanduser("~/kids-tablet/state/tv-remote"))
    ap.add_argument("--fake", action="store_true", help="a pretend TV (pairing code 123456), for the laptop and tests")
    ap.add_argument("--discover", action="store_true", help="print the Google TVs on the LAN and exit")
    ap.add_argument("--agent", default=None, help="tablet agent URL for permission checks (#272)")
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.v else logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if a.discover:
        print(json.dumps(mdns_discover(), indent=1))
        return
    tv = TV(Path(a.state).expanduser(), a.fake)
    agent_url = a.agent if a.agent is not None else os.environ.get("KT_AGENT_URL", "" if a.fake else "http://127.0.0.1:8090")
    serve(tv, a.port, agent_url)


if __name__ == "__main__":
    main()
