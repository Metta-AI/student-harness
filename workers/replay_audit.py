"""Persistent, authenticated replay audit worker. Run on a configured research host.

No game downloads or local simulation are launched by the web application. The
operator supplies release-pinned audit binaries; unknown releases wait for setup.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import tempfile
import threading
import zlib
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get("PRESTON_AUDIT_DATA", "./audit-data")).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
KEY = os.environ.get("PRESTON_AUDIT_WORKER_KEY", "")
REGISTRY = Path(os.environ.get("PRESTON_AUDIT_ENGINES", "./audit-engines.json"))
POOL = ThreadPoolExecutor(max_workers=int(os.environ.get("PRESTON_AUDIT_CONCURRENCY", "2")))
LOCK = threading.Lock()
ACTIVE = set()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(path)


def run_binary(binary, tape, source, slot):
    # The registry is operator-owned. No executable/path/arguments come from the agent.
    result = subprocess.run([binary, "--replay", str(tape)], capture_output=True,
                            text=True, timeout=600,
                            env=dict(os.environ, AUDIT_SOURCE=str(source), AUDIT_SLOT=str(slot)))
    if result.returncode:
        raise ValueError("Pinned audit executable failed")
    return json.loads(result.stdout.strip().splitlines()[-1])


def engine_names(payload):
    return ("replayBinary", "probeBinary" if payload.get("mode") == "candidate-prefix-probe" else "vmBinary")


def execute(job_id):
    path = ROOT / job_id
    try:
        payload = json.loads((path / "input.json").read_text())
        registry = json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {}
        release = payload["release"]
        config = registry.get(release["fingerprint"])
        if not config or config.get("sourceUrl") != release["sourceUrl"]:
            save(path / "status.json", {"status": "waiting", "message": "No pinned audit engine for this release"})
            return
        for name in engine_names(payload):
            if not config.get(name):
                save(path / "status.json", {"status": "waiting", "message": "Pinned diagnostic engine is preparing"})
                return
            binary = Path(config[name]).resolve()
            if digest(binary.read_bytes()) != config[name + "Sha256"]:
                raise ValueError("Audit binary checksum mismatch")
        save(path / "status.json", {"status": "running"})
        tape, source = path / "replay.bin", path / "hero.bas"
        simulation = run_binary(config["replayBinary"], tape, source, payload["slot"])
        if payload.get("mode") == "candidate-prefix-probe":
            if simulation.get("hash_mismatches") != 0:
                raise ValueError("Recorded replay hash mismatch")
            probe = run_binary(config["probeBinary"], tape, source, payload["slot"])
            prefix, first, ticks = probe.get("validated_hashes"), probe.get("first_divergence_tick"), simulation.get("ticks")
            if (not isinstance(prefix, int) or not isinstance(ticks, int) or not 0 <= prefix <= ticks
                    or probe.get("subject") != payload["slot"]
                    or (first is None and prefix != ticks)
                    or (first is not None and (not isinstance(first, int) or first != prefix + 1 or first > ticks))):
                raise ValueError("Invalid candidate prefix receipt")
            save(path / "status.json", {"status": "completed", "result": {
                "kind": "candidate-prefix-probe", "release": release["fingerprint"],
                "replayHash": digest(tape.read_bytes()), "sourceHash": digest(source.read_bytes()),
                "recordedTicks": ticks, "probe": probe,
                "interpretation": "First world-state divergence from recorded play. Stops before extrapolating rival behavior; not a competitive outcome. No divergence does not prove a branch never executed.",
                "engines": {k + "Sha256": config[k + "Sha256"] for k in engine_names(payload)},
            }})
            return
        vm = run_binary(config["vmBinary"], tape, source, payload["slot"]) if source.stat().st_size else None
        if simulation.get("hash_mismatches") != 0 or (vm is not None and vm.get("validated_hashes") != simulation.get("ticks")):
            raise ValueError("Replay or policy VM hash mismatch")
        # A vmBinary must execute AUDIT_SOURCE at AUDIT_SLOT and compare every world hash.
        # Its exact executable digest is part of this server-owned release registration.
        if vm is not None:
            vm["source_hash"] = digest(source.read_bytes())
        events = {}
        for name, tool in config.get("instruments", {}).items():
            if tool.get("requiresSource") and not source.stat().st_size:
                continue
            binary = Path(tool["binary"])
            if digest(binary.read_bytes()) != tool["sha256"]:
                raise ValueError("Replay instrument checksum mismatch")
            events[name] = run_binary(str(binary), tape, source, payload["slot"])
        save(path / "status.json", {"status": "completed", "result": {
            "release": release["fingerprint"], "replayHash": digest(tape.read_bytes()),
            "simulation": simulation, "vm": vm, "events": events,
            "engines": {k: config[k] for k in ("replayBinarySha256", "vmBinarySha256")},
        }})
    except Exception as exc:
        save(path / "status.json", {"status": "failed", "error": str(exc)[:500]})
    finally:
        with LOCK:
            ACTIVE.discard(job_id)


def schedule(job_id):
    with LOCK:
        if job_id not in ACTIVE:
            ACTIVE.add(job_id)
            POOL.submit(execute, job_id)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log request bodies, source, or credentials.

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        return bool(KEY) and hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + KEY)

    def do_GET(self):
        if not self.authorized():
            return self.reply(401, {"error": "Unauthorized"})
        if self.path.startswith("/engines/"):
            fingerprint = self.path.removeprefix("/engines/")
            registry = json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {}
            config = registry.get(fingerprint)
            ready = bool(config) and all(Path(config.get(k, "")).is_file() and digest(Path(config[k]).read_bytes()) == config.get(k + "Sha256") for k in ("replayBinary", "vmBinary"))
            return self.reply(200, {"ready": ready, "sourceUrl": config.get("sourceUrl") if config else None})
        job_id = self.path.removeprefix("/jobs/")
        if not re.fullmatch(r"[a-f0-9]{64}", job_id):
            return self.reply(400, {"error": "Invalid job"})
        path = ROOT / job_id / "status.json"
        if not path.exists():
            return self.reply(404, {"error": "Unknown job"})
        status = json.loads(path.read_text())
        if status["status"] == "completed":
            payload = json.loads((path.parent / "input.json").read_text())
            registry = json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {}
            config = registry.get(payload["release"]["fingerprint"], {})
            expected = {k + "Sha256": config.get(k + "Sha256") for k in engine_names(payload)}
            if all(expected.values()) and config.get("sourceUrl") == payload["release"]["sourceUrl"] and status["result"].get("engines") != expected:
                # Keep the original receipt. An updated decoder can enrich the same
                # immutable replay without another hosted game or changing its identity.
                with LOCK:
                    if job_id not in ACTIVE:
                        receipts = path.parent / "receipts"
                        receipts.mkdir(exist_ok=True)
                        archived = receipts / (digest(json.dumps(status, sort_keys=True).encode()) + ".json")
                        if not archived.exists(): save(archived, status)
                        status = {"status": "queued", "message": "Refreshing decoded evidence with the pinned auditor"}
                        save(path, status)
        if status["status"] in ("queued", "running", "waiting"):
            schedule(job_id)  # Recovers after process restart or engine registration.
        self.reply(200, status)

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {"error": "Unauthorized"})
        if self.path not in ("/jobs", "/validate"):
            return self.reply(404, {"error": "Unknown route"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply(400, {"error": "Invalid payload size"})
        if not 0 < length <= 90 * 1024 * 1024:
            return self.reply(413, {"error": "Invalid payload size"})
        try:
            payload = json.loads(self.rfile.read(length))
            if self.path == "/validate":
                source = payload["source"].encode()
                if not 0 < len(source) <= 65536:
                    raise ValueError("Invalid policy source")
                release = payload["release"]
                registry = json.loads(REGISTRY.read_text()) if REGISTRY.exists() else {}
                config = registry.get(release["fingerprint"], {})
                binary = config.get("validatorBinary")
                if not binary or config.get("sourceUrl") != release["sourceUrl"]:
                    return self.reply(409, {"error": "Pinned policy compiler is preparing"})
                if digest(Path(binary).read_bytes()) != config.get("validatorBinarySha256"):
                    return self.reply(409, {"error": "Pinned policy compiler checksum mismatch"})
                with tempfile.TemporaryDirectory(dir=ROOT, prefix=".validate-") as directory:
                    path = Path(directory) / "hero.bas"
                    path.write_bytes(source)
                    compiled = subprocess.run([binary], capture_output=True, text=True, timeout=30,
                                              env=dict(os.environ, AUDIT_SOURCE=str(path)))
                    if compiled.returncode:
                        return self.reply(502, {"error": "Pinned compiler process failed"})
                    result = json.loads(compiled.stdout.strip().splitlines()[-1])
                if not isinstance(result.get("valid"), bool):
                    raise ValueError("Invalid compiler receipt")
                return self.reply(200, {**result, "sourceHash": digest(source), "release": release["fingerprint"],
                                        "compilerHash": config["validatorBinarySha256"]})
            tape = base64.b64decode(payload.pop("replay"), validate=True)
            encoding = payload.pop("replayEncoding", "identity")
            if encoding == "gzip":
                decoder = zlib.decompressobj(31)
                tape = decoder.decompress(tape, 64 * 1024 * 1024 + 1)
                if len(tape) > 64 * 1024 * 1024 or not decoder.eof or decoder.unused_data:
                    raise ValueError("Invalid compressed replay")
            elif encoding != "identity":
                raise ValueError("Unsupported replay encoding")
            source = payload.pop("source").encode()
            mode = payload.get("mode", "audit")
            if mode not in ("audit", "candidate-prefix-probe") or (mode == "candidate-prefix-probe" and not source):
                raise ValueError("Invalid audit mode")
            slot = payload["slot"]
            if not isinstance(slot, int) or not 0 <= slot < 10 or len(source) > 65536 or len(tape) > 64 * 1024 * 1024:
                raise ValueError("Invalid replay inputs")
            identity = {"release": payload["release"]["fingerprint"], "replay": digest(tape), "source": digest(source), "slot": slot}
            if mode == "candidate-prefix-probe":
                identity["mode"] = mode
            expected = digest(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode())
            if payload["jobId"] != expected:
                raise ValueError("Job identity mismatch")
            path = ROOT / expected
            with LOCK:
                if not path.exists():
                    temporary = Path(tempfile.mkdtemp(dir=ROOT, prefix=".creating-"))
                    (temporary / "hero.bas").write_bytes(source)
                    (temporary / "replay.bin").write_bytes(tape)
                    save(temporary / "input.json", payload)
                    save(temporary / "status.json", {"status": "queued"})
                    temporary.rename(path)
            status = json.loads((path / "status.json").read_text())
            if status["status"] in ("queued", "running", "waiting"):
                schedule(expected)
            self.reply(202, {**status, "jobId": expected})
        except (subprocess.TimeoutExpired, OSError):
            self.reply(502, {"error": "Audit worker operation failed; retry available"})
        except (ValueError, KeyError, TypeError, IndexError, zlib.error):
            self.reply(400, {"error": "Invalid audit inputs"})


if __name__ == "__main__":
    if not KEY:
        raise SystemExit("Set PRESTON_AUDIT_WORKER_KEY")
    ThreadingHTTPServer((os.environ.get("PRESTON_AUDIT_BIND", "127.0.0.1"), int(os.environ.get("PORT", "8097"))), Handler).serve_forever()
