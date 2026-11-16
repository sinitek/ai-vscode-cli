"""Passive macOS process exit events for this harness's exact fork registrations.

NOTE_EXITSTATUS reports the kernel wait status even after the original EH exits.
No signal, wait/reap, process attachment, ref, or production IPC is performed.
Other platforms need an equivalent platform observer; PID absence is never proof.
"""
import json
import os
import select
import sys
import time


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def main():
    if sys.platform != "darwin":
        raise RuntimeError("cold worker exit observer requires macOS kqueue")
    queue = select.kqueue()
    queue.control([select.kevent(0, filter=select.KQ_FILTER_READ, flags=select.KQ_EV_ADD)], 0, 0)
    registrations = {}
    observed = set()
    buffer = b""
    while True:
        for event in queue.control(None, 65, 0.2):
            if event.filter == select.KQ_FILTER_READ:
                chunk = os.read(0, 65536)
                if not chunk:
                    return
                buffer += chunk
                if len(buffer) > 65536:
                    raise RuntimeError("observer input budget")
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    value = json.loads(line)
                    if value == {"operation": "finish"}:
                        return
                    pid = value.get("pid")
                    if not isinstance(pid, int) or pid <= 0 or pid in observed or len(observed) >= 64:
                        raise RuntimeError("observer registration conflict or budget")
                    observed.add(pid)
                    registrations[pid] = value
                    try:
                        # Darwin NOTE_EXITSTATUS = 0x04000000. The returned
                        # status flag is required; a plain exit has no status proof.
                        queue.control([select.kevent(pid, filter=select.KQ_FILTER_PROC,
                            flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                            fflags=select.KQ_NOTE_EXIT | 0x04000000)], 0, 0)
                        emit({"event": "exit-watch-ready", "pid": pid, "at": int(time.time() * 1000)})
                    except OSError as error:
                        emit({"event": "exit-watch-failed", "pid": pid, "errno": error.errno})
            else:
                registration = registrations.pop(event.ident, None)
                if registration is None or not event.fflags & select.KQ_NOTE_EXIT or not event.fflags & 0x04000000:
                    raise RuntimeError("observer exit identity/status missing")
                status = event.data
                emit({**registration, "event": "kernel-worker-exit", "at": int(time.time() * 1000),
                    "waitStatus": status, "code": os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
                    "signal": os.WTERMSIG(status) if os.WIFSIGNALED(status) else None})


if __name__ == "__main__":
    main()
