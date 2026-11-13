
const API = "https://cct419-game-project.onrender.com";

const app = document.getElementById("app");
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;",
  '"': "&quot;", "'": "&#39;"
}[c]));

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

let pid = ls.get("ss.pid");
if (!pid) {
  pid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  ls.set("ss.pid", pid);
}

let code = ls.get("ss.room");
let room = null, target = null, lockT = false, lockS = false;
let err = "", busy = false;

async function api(path, body) {
  const res = await fetch(API + path, body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, ...body })
      }
    : undefined
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: res.status
    });
  }
  return data;
}

async function run(fn) {
  if (busy) return false;
  busy = true;
  err = "";
  render();
  let ok = false;
  try {
    await fn();
    ok = true;
  } catch (e) {
    err = e.status
      ? e.message
      : "Can't reach the game server at " + API + ". Try again.";
  }
  busy = false;
  render();
  return ok;
}

const P = id => (room && room.players[id]) || {};
const order = () => (room && room.order) || [];
const act = (type, extra) => run(async () => {
  room = await api("/api/rooms/" + code + "/action", {
    type, ...extra
  });
});

const actions = {
  create: () => {
    const name = nm();
    if (!name) return;
    run(async () => {
      room = await api("/api/rooms", { name });
      code = room.code;
      ls.set("ss.room", code);
    });
  },

  join: () => {
    const name = nm();
    if (!name) return;
    const c = ($("#code").value || "").toUpperCase().trim();
    if (c.length !== 4) {
      err = "Room codes have 4 letters.";
      return render();
    }
    run(async () => {
      room = await api("/api/rooms/" + c + "/join", { name });
      code = c;
      ls.set("ss.room", c);
    });
  },

  leave: () => run(async () => {
    if (room && ["lobby", "over"].includes(room.phase)) {
      try {
        await api("/api/rooms/" + code + "/action", {
          type: "leave"
        });
      } catch (e) {}
    }
    code = null;
    room = null;
    ls.del("ss.room");
    target = null;
  }),

  start: () => act("start"),
  finishdraft: () => act("finishdraft"),

  defendYes: () => act("defend", {
    use: true,
    defense: $("#defense").value
  }),

  defendNo: () => act("defend", { use: false }),

  ready: () => act("ready", { hp: $("#hp").value }),
  unready: () => act("unready"),
  recharge: () => act("recharge"),
  lobby: () => act("lobby"),

  hit: () => {
    if (!target) {
      err = "Click a player name before attacking.";
      return render();
    }
    act("hit", {
      damage: $("#dmg").value,
      target,
      note: $("#note").value,
      lockTarget: lockT,
      lockSelf: lockS
    }).then(ok => {
      if (ok) {
        target = null;
        lockT = false;
        lockS = false;
      }
    });
  },

  lockT: () => {
    lockT = !lockT;
    render();
  },

  lockS: () => {
    lockS = !lockS;
    render();
  },

  setHp: () => act("sethp", { hp: $("#adj").value }),

  tgt: id => {
    target = target === id ? null : id;
    render();
  }
};

app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled || busy) return;
  const fn = actions[b.dataset.act];
  if (fn) fn(b.dataset.id);
});

function nm() {
  const n = ($("#name").value || "").trim().slice(0, 16);
  if (!n) {
    err = "Pick a username first.";
    render();
  } else {
    ls.set("ss.name", n);
  }
  return n;
}

function row(id, i, ph, cur) {
  const p = P(id);
  const current = ph === "combat" && cur === id && !p.out;
  let status;

  if (ph === "lobby") {
    status = id === room.host ? "Host" : "Joined";
  } else if (ph === "draft") {
    status = "Draft order: " + (i + 1);
  } else if (ph === "hp") {
    status = p.ready ? "Ready, " + p.hp + " HP" : "Entering HP";
  } else {
    status = p.out
      ? "Out"
      : ph === "over" && id === room.winner
        ? "Winner"
        : p.hp + " of " + p.maxHp + " HP" +
          (p.noattack ? ", can't attack next turn" : "");
  }

  const bar = (ph === "combat" || ph === "over") && p.maxHp
    ? `<span class="bar${
        ph === "over" && id === room.winner
          ? " win"
          : p.hp / p.maxHp <= .25 ? " low" : ""
      }"><i style="width:${
        Math.max(0, Math.min(100, p.hp / p.maxHp * 100))
      }%"></i></span>`
    : "";

  return `<li class="p${current ? " cur" : ""}${p.out ? " out" : ""}">
    ${ph === "lobby" ? "" : `<span class="n">${i + 1}</span>`}
    <div class="who">
      <b>${esc(p.name || "Player")}</b>
      ${id === pid ? " <em>you</em>" : ""}
      <small${ph === "lobby" ? ' class="inline"' : ""}>
        ${status}
      </small>
      ${bar}
    </div>
  </li>`;
}

function game() {
  const ph = room.phase;
  const o = order();
  const cur = o[room.turn];
  const mine = cur === pid;
  const host = room.host === pid;
  const d = busy ? " disabled" : "";

  const ids = ph === "lobby"
    ? Object.keys(room.players).sort((a, b) => P(a).at - P(b).at)
    : o;

  const titles = {
    lobby: "Waiting for players",
    draft: "Draft phase",
    hp: "Enter your HP",
    combat: "Combat phase",
    over: "Game over"
  };

  let h = `
    <p class="room">
      <span>Room</span><b class="code">${esc(code)}</b>
    </p>
    <h2>${titles[ph]}</h2>
  `;

  const pending = room.pending;

  if (ph === "combat" && !pending) {
    h += mine
      ? `<div class="turn">
          <b>Your turn</b>
          Choose who you hit and enter the damage.
        </div>`
      : `<div class="wait dark">
          <b>${esc(P(cur).name || "Player")}'s turn</b>
        </div>`;
  }

  const lg = room.log || [];
  const last = [...lg].reverse().find(x => x.k === "turn");

  if ((ph === "combat" || ph === "over") && last) {
    h += `<p class="note last">
      <b>Last turn:</b> ${esc(last.text)}
    </p>`;
  }

  if (ph === "over") {
    h += `<p class="note">${
      room.winner
        ? esc(P(room.winner).name) + " is the last robot standing."
        : "Nobody survived."
    }</p>`;
  }

  h += `<ol>${ids.map((id, i) => row(id, i, ph, cur)).join("")}</ol>`;

  const me = P(pid);

  if (ph === "lobby") {
    h += `<p class="hint" style="margin-top:14px">
      Share the room code. Everyone who joins appears above.
    </p>`;

    h += host
      ? `<button class="btn primary" data-act="start"${d}>
          Start game
        </button>`
      : `<p>Waiting for the host to start.</p>`;

    h += `<button class="btn" data-act="leave"${d}>
      Leave room
    </button>`;
  }

  else if (ph === "draft") {
    h += `<div class="sep"></div>
      <p>Follow the player order above for 6 rounds of drafting.
      The host can advance everyone when drafting is complete.</p>`;

    h += host
      ? `<button class="btn primary" data-act="finishdraft"${d}>
          Done drafting phase
        </button>`
      : `<p class="hint">
          Waiting for the host to finish the drafting phase.
        </p>`;
  }

  else if (ph === "hp") {
    h += `<div class="sep"></div>
      <p>Add up your robot's HP and enter it.
      Combat starts when everyone is ready.</p>`;

    h += me.ready
      ? `<p><b>You're ready at ${me.hp} HP.</b></p>
        <button class="btn" data-act="unready"${d}>
          Change my HP
        </button>`
      : `<label for="hp">Your total HP</label>
        <input id="hp" type="number" inputmode="numeric" min="1">
        <button class="btn primary" data-act="ready"${d}>
          Ready
        </button>`;
  }

  else if (ph === "combat") {
    h += `<div class="sep"></div>`;

    if (pending) {
      const isDefender = pending.targets.includes(pid);
      const answered = Object.prototype.hasOwnProperty.call(
        pending.responses, pid
      );

      h += `<div class="wait dark">
        <b>Attack pending</b>
        ${esc(P(pending.attacker).name)} is attacking for
        ${pending.damage} damage.
        Waiting for Burst Defend responses.
      </div>`;

      if (isDefender && !answered) {
        h += `<div class="turn">
          <b>Do you have a Burst Defend card?</b>
          <p>Enter your Burst Defend stat to reduce
          the incoming ${pending.damage} damage.</p>

          <label for="defense">Burst Defend stat</label>
          <input id="defense" type="number"
            inputmode="numeric" min="0" value="0">

          <button class="btn primary" data-act="defendYes"${d}>
            Use Burst Defend
          </button>

          <button class="btn" data-act="defendNo"${d}>
            No Burst Defend
          </button>
        </div>`;
      } else if (isDefender) {
        h += `<p class="hint">
          You responded. Waiting for the other defenders.
        </p>`;
      } else {
        h += `<p class="hint">
          Wait for the defending players to respond.
        </p>`;
      }
    }

    else if (me.out) {
      h += `<p>You're out of the game.
        Watch the rest of the fight.</p>`;
    }

    else {
      if (mine && me.noattack) {
        h += `<p><b>You can't attack this turn.</b>
          Recharge your limbs instead.</p>
          <button class="btn primary" data-act="recharge"${d}>
            Recharge
          </button>`;
      }

      else if (mine) {
        const alive = o.filter(id => !P(id).out && id !== pid);

        h += `<p class="hint">
          Pick one player to attack, or everyone.
        </p>
        <div>
          <button class="chip"
            aria-pressed="${target === "all"}"
            data-act="tgt" data-id="all">Everyone</button>
          ${alive.map(id => `
            <button class="chip"
              aria-pressed="${target === id}"
              data-act="tgt" data-id="${esc(id)}">
              ${esc(P(id).name)}
            </button>
          `).join("")}
        </div>

        <label for="dmg">Damage dealt (0 if none)</label>
        <input id="dmg" type="number"
          inputmode="numeric" min="0">

        <label for="note">Effect note (optional)</label>
        <input id="note" maxlength="80"
          autocomplete="off"
          placeholder="e.g. deactivated a Plant limb">

        <div>
          <button class="chip"
            aria-pressed="${lockT}" data-act="lockT">
            Target can't attack next turn
          </button>
          <button class="chip"
            aria-pressed="${lockS}" data-act="lockS">
            I can't attack next turn
          </button>
        </div>

        <button class="btn primary" data-act="hit"${d}>
          Attack
        </button>
        <button class="btn" data-act="recharge"${d}>
          Recharge instead
        </button>`;
      }

      h += `<div class="sep"></div>
        <label for="adj">
          Adjust my HP (any time, doesn't use your turn)
        </label>
        <input id="adj" type="number"
          inputmode="numeric" min="0"
          placeholder="Now ${me.hp}">
        <button class="btn" data-act="setHp"${d}>
          Set my HP
        </button>`;
    }
  }

  else if (ph === "over") {
    h += host
      ? `<button class="btn primary" data-act="lobby"${d}>
          Play again
        </button>`
      : `<p class="hint">
          The host can start a new game.
        </p>`;

    h += `<button class="btn ghost" data-act="leave"${d}>
      Leave room
    </button>`;
  }

  if ((ph === "combat" || ph === "over") && lg.length) {
    h += `<div class="sep">Combat log</div>
      <ul class="log">
        ${lg.slice(-10).reverse().map(x => `
          <li class="${x.k}">${esc(x.text)}</li>
        `).join("")}
      </ul>`;
  }

  if (host && ["draft", "hp", "combat"].includes(ph)) {
    h += `<div class="sep"></div>
      <button class="btn" data-act="lobby"${d}>
        Reset game and return to the lobby
      </button>`;
  }

  return h;
}

function view() {
  const e = err
    ? `<p class="err" role="alert">${esc(err)}</p>`
    : "";

  if (!code) {
    return `${e}
      <label for="name">Username</label>
      <input id="name" maxlength="16"
        autocomplete="off"
        value="${esc(ls.get("ss.name") || "")}">

      <button class="btn primary" data-act="create"
        ${busy ? "disabled" : ""}>
        Create a room
      </button>

      <div class="sep">Joining a friend's room?</div>

      <label for="code">Room code</label>
      <input id="code" maxlength="4"
        autocomplete="off" autocapitalize="characters">

      <button class="btn primary" data-act="join"
        ${busy ? "disabled" : ""}>
        Join room
      </button>`;
  }

  if (!room) {
    return `${e}<p class="hint">Loading room…</p>
      <button class="btn" data-act="leave">Leave room</button>`;
  }

  return e + game();
}

function render() {
  const keep = {};
  app.querySelectorAll("input").forEach(i => {
    keep[i.id] = i.value;
  });

  const fid = document.activeElement && document.activeElement.id;
  app.innerHTML = view();

  for (const id in keep) {
    const el = document.getElementById(id);
    if (el && keep[id] !== "") el.value = keep[id];
  }

  if (fid) {
    const el = document.getElementById(fid);
    if (el) el.focus();
  }
}

// Keep all players synchronized with the server.
async function poll() {
  if (!code || busy) return;

  try {
    room = await api("/api/rooms/" + code + "?pid=" + pid);

    if (!room.players[pid]) {
      const name = ls.get("ss.name");
      if (room.phase === "lobby" && name) {
        room = await api("/api/rooms/" + code + "/join", { name });
      } else {
        code = null;
        room = null;
        ls.del("ss.room");
        err = "You're no longer in that room.";
      }
    } else {
      err = "";
    }

    render();
  } catch (e) {
    if (e.status === 404) {
      code = null;
      room = null;
      ls.del("ss.room");
      err = "That room no longer exists.";
    } else {
      err = "Can't reach the game server at " + API + ". Retrying…";
    }
    render();
  }
}

setInterval(poll, 1500);
render();
poll();
