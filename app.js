// After deploying the backend, paste its URL here (no trailing slash).
const API = "https://cct419-game-project.onrender.com";

const app = document.getElementById("app");
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

let pid = ls.get("ss.pid");
if (!pid) { pid = Math.random().toString(36).slice(2) + Date.now().toString(36); ls.set("ss.pid", pid); }
let code = ls.get("ss.room"), room = null, sel = new Set(), err = "", busy = false;

async function api(path, body) {
  const res = await fetch(API + path, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid, ...body }) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: res.status });
  return data;
}
async function run(fn) {
  if (busy) return;
  busy = true; err = ""; render();
  try { await fn(); }
  catch (e) { err = e.status ? e.message : "Can’t reach the game server at " + API + ". Try again in a moment."; }
  busy = false; render();
}
const P = id => (room && room.players[id]) || {};
const order = () => (room && room.order) || [];
const act = (type, extra) => run(async () => { room = await api("/api/rooms/" + code + "/action", { type, ...extra }); });

const actions = {
  create: () => {
    const name = nm(); if (!name) return;
    run(async () => { room = await api("/api/rooms", { name }); code = room.code; ls.set("ss.room", code); });
  },
  join: () => {
    const name = nm(); if (!name) return;
    const c = ($("#code").value || "").toUpperCase().trim();
    if (c.length !== 4) { err = "Room codes have 4 letters."; return render(); }
    run(async () => { room = await api("/api/rooms/" + c + "/join", { name }); code = c; ls.set("ss.room", c); });
  },
  leave: () => run(async () => {
    if (room && (room.phase === "lobby" || room.phase === "over")) {
      try { await api("/api/rooms/" + code + "/action", { type: "leave" }); } catch (e) {}
    }
    code = null; room = null; ls.del("ss.room"); sel.clear();
  }),
  start: () => act("start"),
  end: () => act("end"),
  done: () => act("done"),
  undo: () => act("undo"),
  ready: () => act("ready", { hp: $("#hp").value }),
  unready: () => act("unready"),
  recharge: () => act("recharge"),
  lobby: () => act("lobby"),
  hit: () => { const t = [...sel]; act("hit", { damage: $("#dmg").value, targets: t }).then(() => sel.clear()); },
  setHp: () => act("sethp", { hp: $("#adj").value }),
  tgt: id => { sel.has(id) ? sel.delete(id) : sel.add(id); render(); },
  everyone: () => { sel = new Set(order().filter(id => id !== pid && !P(id).out)); render(); }
};
app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled || (busy && !["tgt", "everyone"].includes(b.dataset.act))) return;
  actions[b.dataset.act](b.dataset.id);
});
function nm() {
  const n = ($("#name").value || "").trim().slice(0, 16);
  if (!n) { err = "Pick a username first."; render(); } else ls.set("ss.name", n);
  return n;
}

function row(id, i, ph, cur) {
  const p = P(id), c = (ph === "draft" || ph === "combat") && cur === id && !p.out;
  let st;
  if (ph === "lobby") st = id === room.host ? "Host" : "Joined";
  else if (ph === "draft") st = p.done ? "Done building" : "Drafting";
  else if (ph === "hp") st = p.ready ? "Ready, " + p.hp + " HP" : "Entering HP";
  else st = p.out ? "Out" : (ph === "over" && id === room.winner ? "Winner" : p.hp + " of " + p.maxHp + " HP");
  const bar = (ph === "combat" || ph === "over") && p.maxHp
    ? `<span class="bar${p.hp / p.maxHp <= .25 ? " low" : ""}"><i style="width:${Math.max(0, Math.min(100, p.hp / p.maxHp * 100))}%"></i></span>` : "";
  return `<li class="p${c ? " cur" : ""}${p.out ? " out" : ""}">${ph === "lobby" ? "" : `<span class="n">${i + 1}</span>`}<div class="who"><b>${esc(p.name || "Player")}</b>${id === pid ? " <em>you</em>" : ""}<small>${st}</small>${bar}</div></li>`;
}
function game() {
  const ph = room.phase, o = order(), cur = o[room.turn], mine = cur === pid, host = room.host === pid, d = busy ? " disabled" : "";
  const ids = ph === "lobby" ? Object.keys(room.players).sort((a, b) => P(a).at - P(b).at) : o;
  const titles = { lobby: "Waiting for players", draft: "Draft phase", hp: "Enter your HP", combat: "Combat phase", over: "Game over" };
  let h = `<p>Room<span class="code">${esc(code)}</span></p><h2>${titles[ph]}</h2>`;
  if (ph === "draft" || ph === "combat")
    h += mine ? `<div class="turn"><b>Your turn</b>${ph === "draft" ? "Pick up a card, then end your turn." : "Choose who you hit and enter the damage."}</div>`
              : `<div class="wait"><b>${esc(P(cur).name || "Player")}’s turn</b></div>`;
  if (ph === "over") h += `<p><b>${room.winner ? esc(P(room.winner).name) + " is the last robot standing." : "Nobody survived."}</b></p>`;
  h += `<ol>${ids.map((id, i) => row(id, i, ph, cur)).join("")}</ol>`;
  const me = P(pid);
  if (ph === "lobby") {
    h += `<p class="hint" style="margin-top:14px">Share the room code. Everyone who joins appears above.</p>`;
    h += (host ? `<button class="btn primary" data-act="start"${d}>Start game</button>` : `<p>Waiting for the host to start.</p>`) + `<button class="btn" data-act="leave"${d}>Leave room</button>`;
  } else if (ph === "draft") {
    h += `<div class="sep"></div>`;
    h += me.done ? `<p>You’re done building, so the app skips your turns.</p><button class="btn" data-act="undo"${d}>I’m not done yet</button>`
      : `<p class="hint">${mine ? "" : "Wait for your turn. "}Press the button below once your robot is complete.</p>${mine ? `<button class="btn primary" data-act="end"${d}>End turn</button>` : ""}<button class="btn" data-act="done"${d}>I’m done building</button>`;
  } else if (ph === "hp") {
    h += `<div class="sep"></div><p>Add up your robot’s HP and enter it. Combat starts when everyone is ready.</p>`;
    h += me.ready ? `<p><b>You’re ready at ${me.hp} HP.</b></p><button class="btn" data-act="unready"${d}>Change my HP</button>`
      : `<label for="hp">Your total HP</label><input id="hp" type="number" inputmode="numeric" min="1"><button class="btn primary" data-act="ready"${d}>Ready</button>`;
  } else if (ph === "combat") {
    h += `<div class="sep"></div>`;
    if (me.out) h += `<p>You’re out of the game. Watch the rest of the fight.</p>`;
    else {
      if (mine) {
        const alive = o.filter(id => !P(id).out);
        h += `<p class="hint">Pick who takes the hit. If the attack hits everyone, select everyone.</p><div>${alive.map(id => `<button class="chip" aria-pressed="${sel.has(id)}" data-act="tgt" data-id="${esc(id)}">${esc(P(id).name)}${id === pid ? " (you)" : ""}</button>`).join("")}</div><button class="btn" data-act="everyone">Select everyone else</button><label for="dmg">Damage dealt</label><input id="dmg" type="number" inputmode="numeric" min="1"><button class="btn primary" data-act="hit"${d}>Apply damage</button><button class="btn" data-act="recharge"${d}>Recharge instead</button>`;
      }
      h += `<label for="adj">Correct my HP</label><input id="adj" type="number" inputmode="numeric" min="0"><button class="btn" data-act="setHp"${d}>Set my HP</button>`;
    }
  } else if (ph === "over") {
    h += (host ? `<button class="btn primary" data-act="lobby"${d}>Play again</button>` : `<p class="hint">The host can start a new game.</p>`) + `<button class="btn" data-act="leave"${d}>Leave room</button>`;
  }
  if (host && ["draft", "hp", "combat"].includes(ph)) h += `<div class="sep"></div><button class="btn" data-act="lobby"${d}>Reset game and return to the lobby</button>`;
  return h;
}
function view() {
  const e = err ? `<p class="err" role="alert">${esc(err)}</p>` : "";
  if (!code) return `${e}<label for="name">Username</label><input id="name" maxlength="16" autocomplete="off" value="${esc(ls.get("ss.name") || "")}"><button class="btn primary" data-act="create"${busy ? " disabled" : ""}>Create a room</button><div class="sep">Joining a friend’s room?</div><label for="code">Room code</label><input id="code" maxlength="4" autocomplete="off" autocapitalize="characters"><button class="btn" data-act="join"${busy ? " disabled" : ""}>Join room</button>`;
  if (!room) return `${e}<p class="hint">Loading room…</p><button class="btn" data-act="leave">Leave room</button>`;
  return e + game();
}
function render() {
  const keep = {}; app.querySelectorAll("input").forEach(i => { keep[i.id] = i.value; });
  const fid = document.activeElement && document.activeElement.id;
  app.innerHTML = view();
  for (const id in keep) { const el = document.getElementById(id); if (el && keep[id] !== "") el.value = keep[id]; }
  if (fid) { const el = document.getElementById(fid); if (el) el.focus(); }
}

// Poll the server so every player sees the same room.
async function poll() {
  if (!code || busy) return;
  try {
    room = await api("/api/rooms/" + code + "?pid=" + pid);
    if (!room.players[pid]) {
      const name = ls.get("ss.name");
      if (room.phase === "lobby" && name) room = await api("/api/rooms/" + code + "/join", { name });
      else { code = null; room = null; ls.del("ss.room"); err = "You’re no longer in that room."; }
    } else err = "";
    render();
  }
  catch (e) {
    if (e.status === 404) { code = null; room = null; ls.del("ss.room"); err = "That room no longer exists."; }
    else err = "Can’t reach the game server at " + API + ". Retrying…";
    render();
  }
}
setInterval(poll, 1500);
render();
poll();