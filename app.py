
import os
import random
import secrets
import threading
import time

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=os.environ.get("ALLOWED_ORIGIN", "*"))

rooms = {}
lock = threading.Lock()
STALE = 25

BLANK = dict(
    hp=None,
    maxHp=None,
    ready=False,
    out=False,
    noattack=False
)


def fail(message, status=400):
    return jsonify(error=message), status


def integer(value, minimum=0):
    if isinstance(value, bool):
        raise ValueError()
    n = int(value)
    if n < minimum or n > 1000000:
        raise ValueError()
    return n


def next_idx(room, start, ok):
    order = room["order"]
    for step in range(1, len(order) + 1):
        idx = (start + step) % len(order)
        if ok(order[idx]):
            return idx
    return start


def settle(room, advance):
    alive = [
        i for i in room["order"]
        if i in room["players"] and not room["players"][i]["out"]
    ]

    if len(alive) <= 1:
        room["phase"] = "over"
        room["winner"] = alive[0] if alive else None

    elif advance or room["order"][room["turn"]] not in alive:
        room["turn"] = next_idx(
            room,
            room["turn"],
            lambda i: i in alive
        )


def remove_player(room, pid):
    room["players"].pop(pid, None)

    if pid in room["order"]:
        old = room["order"].index(pid)
        room["order"].remove(pid)

        if room["order"]:
            if old < room["turn"]:
                room["turn"] -= 1
            room["turn"] %= len(room["order"])
        else:
            room["turn"] = 0

    if room["host"] == pid and room["players"]:
        room["host"] = min(
            room["players"],
            key=lambda i: room["players"][i]["at"]
        )


def touch(room, pid):
    if room and pid in room["players"]:
        room["players"][pid]["seen"] = time.time()


def tidy(code):
    room = rooms.get(code)
    if not room:
        return None

    if room["phase"] == "lobby":
        now = time.time()
        for pid in [
            i for i, p in room["players"].items()
            if now - p.get("seen", now) > STALE
        ]:
            remove_player(room, pid)

    if not room["players"]:
        rooms.pop(code, None)
        return None

    return room


def note(room, message, kind="turn"):
    room["log"].append(dict(k=kind, text=message))
    del room["log"][:-40]


def apply(room, pid, action):
    players = room["players"]
    phase = room["phase"]
    me = players[pid]

    cur = (
        room["order"][room["turn"]]
        if room["order"] else None
    )

    kind = action.get("type")

    # START GAME
    if kind == "start" and phase == "lobby":
        if pid != room["host"]:
            return "Only the host can start the game."

        if len(players) < 2:
            return "You need at least 2 players."

        ids = list(players)
        random.shuffle(ids)

        for i in ids:
            players[i].update(BLANK)

        room.update(
            phase="draft",
            order=ids,
            turn=0,
            winner=None,
            log=[],
            pending=None
        )

    # HOST ENDS THE SIX-ROUND DRAFT
    elif kind == "finishdraft" and phase == "draft":
        if pid != room["host"]:
            return "Only the host can finish drafting."

        room.update(phase="hp", turn=0)

    # RETURN TO LOBBY
    elif kind == "lobby":
        if pid != room["host"]:
            return "Only the host can reset the game."

        for i in players:
            players[i].update(BLANK)

        room.update(
            phase="lobby",
            order=[],
            turn=0,
            winner=None,
            log=[],
            pending=None
        )

    # ENTER STARTING HP
    elif kind == "ready" and phase == "hp":
        hp = integer(action.get("hp"), 1)

        me.update(
            hp=hp,
            maxHp=hp,
            ready=True
        )

        if all(players[i]["ready"] for i in room["order"]):
            room.update(phase="combat", turn=0)

    elif kind == "unready" and phase == "hp":
        me["ready"] = False

    # ATTACK: WAIT FOR BURST DEFEND
    elif kind == "hit" and phase == "combat" and cur == pid:
        if room["pending"]:
            return "Wait for the defenders to respond."

        if me["noattack"]:
            return "You can't attack this turn. Recharge instead."

        target = action.get("target")

        alive = [
            i for i in room["order"]
            if i != pid and not players[i]["out"]
        ]

        if not target:
            return "Click a player name before attacking."

        if target == "all":
            targets = alive
        elif target in alive:
            targets = [target]
        else:
            return "You can't attack yourself or someone already out."

        if not targets:
            return "There are no valid targets."

        damage = integer(action.get("damage"))
        extra = str(action.get("note", "")).strip()[:80]

        room["pending"] = dict(
            attacker=pid,
            targets=targets,
            responses={},
            damage=damage,
            note=extra,
            lockTarget=bool(action.get("lockTarget")),
            lockSelf=bool(action.get("lockSelf"))
        )

    # DEFENDER RESPONDS TO ATTACK
    elif kind == "defend" and phase == "combat":
        pending = room["pending"]

        if not pending or pid not in pending["targets"]:
            return "There is no attack waiting for your response."

        if pid in pending["responses"]:
            return "You already responded to this attack."

        use = action.get("use") is True

        defense = (
            integer(action.get("defense"))
            if use else 0
        )

        pending["responses"][pid] = defense

        # RESOLVE WHEN EVERY DEFENDER HAS ANSWERED
        if len(pending["responses"]) == len(pending["targets"]):
            attacker = players[pending["attacker"]]

            target_names = (
                "everyone"
                if len(pending["targets"]) > 1
                else players[pending["targets"][0]]["name"]
            )

            parts = []

            for target in pending["targets"]:
                p = players[target]

                blocked = pending["responses"][target]
                actual = max(0, pending["damage"] - blocked)

                p["hp"] = max(0, p["hp"] - actual)
                p["out"] = p["hp"] == 0

                if pending["lockTarget"] and not p["out"]:
                    p["noattack"] = True

                parts.append(
                    f"{p['name']} blocked "
                    f"{min(blocked, pending['damage'])}, "
                    f"took {actual}"
                    + (" and is out" if p["out"] else "")
                )

            attacker["noattack"] = pending["lockSelf"]

            message = (
                f"{attacker['name']} attacked "
                f"{target_names} for {pending['damage']}. "
                + "; ".join(parts) + "."
            )

            if pending["note"]:
                message += f" ({pending['note']})"

            if pending["lockTarget"]:
                message += (
                    " Surviving targets cannot attack next turn."
                )

            if pending["lockSelf"]:
                message += (
                    f" {attacker['name']} cannot attack next turn."
                )

            note(room, message)

            room["pending"] = None
            settle(room, True)

    # RECHARGE
    elif kind == "recharge" and phase == "combat" and cur == pid:
        if room["pending"]:
            return "Wait for the defenders to respond."

        me["noattack"] = False

        note(room, f"{me['name']} recharged.")
        settle(room, True)

    # MANUAL HP ADJUSTMENT, INCLUDING OVERHEAL
    elif kind == "sethp" and phase == "combat" and not me["out"]:
        if room["pending"]:
            return "Wait until the attack is resolved to adjust HP."

        hp = integer(action.get("hp"))
        old = me["hp"]

        me.update(
            hp=hp,
            maxHp=max(me["maxHp"] or 0, hp),
            out=hp == 0
        )

        message = (
            f"{me['name']} changed their HP "
            f"from {old} to {hp}."
        )

        if hp == 0:
            message += " They are out."

        note(room, message, "hp")

        if hp == 0:
            settle(room, False)

    # LEAVE ROOM
    elif kind == "leave" and phase in ("lobby", "over"):
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

    name = str(d.get("name", "")).strip()[:16]
    pid = str(d.get("pid", ""))[:128]

    if not name or not pid:
        return fail("Pick a username first.")

    with lock:
        cutoff = time.time() - 12 * 3600

        for c in [
            c for c, r in rooms.items()
            if r["at"] < cutoff
        ]:
            del rooms[c]

        code = "".join(
            secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ")
            for _ in range(4)
        )

        while code in rooms:
            code = "".join(
                secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ")
                for _ in range(4)
            )

        rooms[code] = dict(
            code=code,
            host=pid,
            phase="lobby",
            order=[],
            turn=0,
            winner=None,
            at=time.time(),
            log=[],
            pending=None,
            players={
                pid: dict(
                    name=name,
                    at=time.time(),
                    seen=time.time(),
                    **BLANK
                )
            }
        )

        return jsonify(rooms[code])


@app.post("/api/rooms/<code>/join")
def join(code):
    d = request.get_json(silent=True) or {}

    name = str(d.get("name", "")).strip()[:16]
    pid = str(d.get("pid", ""))[:128]

    if not pid:
        return fail("Missing player ID.")

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

            room["players"][pid] = dict(
                name=name,
                at=time.time(),
                seen=time.time(),
                **BLANK
            )

        touch(room, pid)
        return jsonify(room)


@app.get("/api/rooms/<code>")
def state(code):
    with lock:
        pid = request.args.get("pid", "")
        touch(rooms.get(code.upper()), pid)
        room = tidy(code.upper())

        if not room:
            return fail("Room not found.", 404)

        if pid not in room["players"]:
            return fail("You are not in this room.", 403)

        return jsonify(room)


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
        except (ValueError, TypeError, OverflowError):
            msg = (
                "Enter a valid whole number (0 to 1,000,000)."
            )

        if msg:
            return fail(msg)

        if not room["players"]:
            rooms.pop(code.upper(), None)

        return jsonify(room)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000))
    )
