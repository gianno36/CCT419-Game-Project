import os
import random
import string
import threading
import time

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=os.environ.get("ALLOWED_ORIGIN", "*"))

rooms = {}
lock = threading.Lock()
BLANK = dict(hp=None, maxHp=None, done=False, ready=False, out=False)


def fail(msg, status=400):
    return jsonify(error=msg), status


def next_idx(room, start, ok):
    order = room["order"]
    for i in range(1, len(order) + 1):
        j = (start + i) % len(order)
        if ok(order[j]):
            return j
    return start


def settle(room, advance):
    """Check for a winner, then move to the next living player."""
    p = room["players"]
    alive = [i for i in room["order"] if not p[i]["out"]]
    if len(alive) <= 1:
        room["phase"] = "over"
        room["winner"] = alive[0] if alive else None
    elif advance or room["order"][room["turn"]] not in alive:
        room["turn"] = next_idx(room, room["turn"], lambda i: i in alive)


STALE = 25  # seconds without contact before a lobby player is dropped


def remove_player(room, pid):
    room["players"].pop(pid, None)
    if pid in room["order"]:
        room["order"].remove(pid)
        room["turn"] = 0
    if room["host"] == pid and room["players"]:
        room["host"] = min(room["players"], key=lambda i: room["players"][i]["at"])


def touch(room, pid):
    if room and pid in room["players"]:
        room["players"][pid]["seen"] = time.time()


def tidy(code):
    """Drop lobby players who closed the tab, and delete empty rooms."""
    room = rooms.get(code)
    if not room:
        return None
    if room["phase"] == "lobby":
        now = time.time()
        for i in [i for i, p in room["players"].items() if now - p.get("seen", now) > STALE]:
            remove_player(room, i)
    if not room["players"]:
        del rooms[code]
        return None
    return room


def apply(room, pid, a):
    """Run one action. Returns an error message, or None on success."""
    p, ph = room["players"], room["phase"]
    me = p[pid]
    cur = room["order"][room["turn"]] if room["order"] else None
    t = a.get("type")

    if t == "start":
        if pid != room["host"]:
            return "Only the host can start the game."
        if len(p) < 2:
            return "You need at least 2 players."
        ids = list(p)
        random.shuffle(ids)
        for i in ids:
            p[i].update(BLANK)
        room.update(phase="draft", order=ids, turn=0, winner=None)
    elif t == "lobby":
        if pid != room["host"]:
            return "Only the host can do that."
        for i in p:
            p[i].update(BLANK)
        room.update(phase="lobby", order=[], turn=0, winner=None)
    elif t == "end" and ph == "draft" and cur == pid:
        room["turn"] = next_idx(room, room["turn"], lambda i: not p[i]["done"])
    elif t == "done" and ph == "draft" and cur == pid:
        me["done"] = True
        if all(p[i]["done"] for i in room["order"]):
            room.update(phase="hp", turn=0)
        elif cur == pid:
            room["turn"] = next_idx(room, room["turn"], lambda i: not p[i]["done"])
    elif t == "undo" and ph == "draft":
        me["done"] = False
    elif t == "ready" and ph == "hp":
        hp = int(a.get("hp", 0))
        if hp < 1:
            return "Enter an HP above 0."
        me.update(hp=hp, maxHp=hp, ready=True)
        if all(p[i]["ready"] for i in room["order"]):
            room.update(phase="combat", turn=0)
    elif t == "unready" and ph == "hp":
        me["ready"] = False
    elif t == "hit" and ph == "combat" and cur == pid:
        target = a.get("target")
        if not target:
            return "Pick a player to hit."
        if target not in p or target == pid or p[target]["out"]:
            return "You can't hit yourself or a player who is already out."
        dmg = int(a.get("damage", 0))
        if dmg < 1:
            return "Enter the damage dealt."
        p[target]["hp"] = max(0, p[target]["hp"] - dmg)
        p[target]["out"] = p[target]["hp"] == 0
        settle(room, True)
    elif t == "recharge" and ph == "combat" and cur == pid:
        settle(room, True)
    elif t == "leave" and ph in ("lobby", "over"):
        remove_player(room, pid)
    else:
        return "That action isn't available right now."
    return None


@app.get("/")
def health():
    return "Scrapyard Scavengers server is running."


@app.post("/api/rooms")
def create():
    d = request.get_json(silent=True) or {}
    name, pid = str(d.get("name", "")).strip()[:16], str(d.get("pid", ""))
    if not name or not pid:
        return fail("Pick a username first.")
    with lock:
        cutoff = time.time() - 12 * 3600
        for c in [c for c, r in rooms.items() if r["at"] < cutoff]:
            del rooms[c]
        code = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=4))
        while code in rooms:
            code = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=4))
        rooms[code] = dict(code=code, host=pid, phase="lobby", order=[], turn=0,
                           winner=None, at=time.time(),
                           players={pid: dict(name=name, at=time.time(), **BLANK)})
        touch(rooms[code], pid)
        return jsonify(rooms[code])


@app.post("/api/rooms/<code>/join")
def join(code):
    d = request.get_json(silent=True) or {}
    name, pid = str(d.get("name", "")).strip()[:16], str(d.get("pid", ""))
    with lock:
        touch(rooms.get(code.upper()), pid)
        room = tidy(code.upper())
        if not room:
            return fail("No room with that code.", 404)
        if pid not in room["players"]:
            if room["phase"] != "lobby":
                return fail("That game has already started.")
            if not name:
                return fail("Pick a username first.")
            room["players"][pid] = dict(name=name, at=time.time(), **BLANK)
        touch(room, pid)
        return jsonify(room)


@app.get("/api/rooms/<code>")
def state(code):
    with lock:
        touch(rooms.get(code.upper()), request.args.get("pid", ""))
        room = tidy(code.upper())
        return (jsonify(room) if room else fail("Room not found.", 404))


@app.post("/api/rooms/<code>/action")
def action(code):
    d = request.get_json(silent=True) or {}
    pid = str(d.get("pid", ""))
    with lock:
        touch(rooms.get(code.upper()), pid)
        room = tidy(code.upper())
        if not room or pid not in room["players"]:
            return fail("Room not found.", 404)
        try:
            msg = apply(room, pid, d)
        except (ValueError, TypeError):
            msg = "Enter a whole number."
        if msg:
            return fail(msg)
        if not room["players"]:
            rooms.pop(code.upper(), None)
        return jsonify(room)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))