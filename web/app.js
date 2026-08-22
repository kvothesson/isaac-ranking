// config.js no esta en el repo: lo escribe el deploy. Si falta, o si todavia
// tiene los placeholders, el sitio arranca en modo demo en vez de romperse.
const { SUPABASE_URL: URL_BASE = "", SUPABASE_ANON_KEY: KEY = "" } = window.ISAAC_CONFIG ?? {};
const PAGE = 50;

const $ = (s) => document.querySelector(s);
const rows = $("#rows");
let offset = 0;
let total = 641; // se corrige con el primer fetch

// Sin Supabase configurado el sitio corre contra web/demo.json, que se genera
// con test/demo.mts a partir de datos reales de Steam. Sirve para verlo andar
// antes de desplegar nada.
const DEMO = !URL_BASE || !KEY || /TU_PROJECT_REF|TU_ANON_KEY/.test(`${URL_BASE}${KEY}`);
let demoData = null;
const cargarDemo = async () => {
  if (!demoData) demoData = await (await fetch("demo.json")).json();
  return demoData;
};

// Resuelve localmente las mismas consultas que le haria a PostgREST.
const restDemo = async (path) => {
  const d = await cargarDemo();
  const num = (k, def) => Number(new URLSearchParams(path.split("?")[1]).get(k) ?? def);
  if (path.startsWith("site_stats")) return [d.site_stats];
  if (path.startsWith("achievements")) return d.achievements;
  if (path.startsWith("leaderboard")) {
    const off = num("offset", 0);
    return d.leaderboard.slice(off, off + num("limit", 50));
  }
  if (path.startsWith("players")) {
    const id = decodeURIComponent(path.match(/steamid64=eq\.([^&]+)/)?.[1] ?? "");
    return d.leaderboard.filter((p) => p.steamid64 === id);
  }
  return [];
};

const rest = async (path) => {
  if (DEMO) return restDemo(path);
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

const fn = async (name, body) => {
  const r = await fetch(`${URL_BASE}/functions/v1/${name}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, data: await r.json() };
};

const esc = (s) =>
  String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

// ISO 8601: se lee igual en cualquier idioma, a diferencia de "18 de sept de 2025".
const fecha = (iso) => (iso ? iso.slice(0, 10) : "");

const icono = (id, clase = "") => `<svg class="ic ${clase}"><use href="#i-${id}"/></svg>`;

// Steam a veces no devuelve avatar. Un <img src=""> muestra el icono de imagen
// rota, asi que en ese caso va un cuadrito vacio.
const avatar = (url, size = 28) =>
  url
    ? `<img src="${esc(url)}" alt="" loading="lazy" style="width:${size}px;height:${size}px">`
    : `<span class="ph" style="width:${size}px;height:${size}px"></span>`;

// --- ranking ----------------------------------------------------------------

function fila(p) {
  const pct = total ? (p.unlocked_count / total) * 100 : 0;
  return `
  <tr class="${p.is_complete ? "complete" : ""}" data-id="${esc(p.steamid64)}">
    <td class="c-rank">${p.rank}</td>
    <td>
      <div class="who">
        ${avatar(p.avatar)}
        <div>
          <b>${esc(p.display_name)}</b>
          ${p.dead_god ? `<span class="tag" title="Unlocked the in-game Dead God achievement">${icono("skull", "skull")} dead god</span>` : ""}
          ${p.is_complete ? `<span class="tag full" title="Has every Steam achievement">${total}/${total}</span>` : ""}
          ${p.sintetico ? '<span class="tag fake">demo</span>' : ""}
          <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        </div>
      </div>
    </td>
    <td class="c-num">${p.unlocked_count}<span class="tot">/${total}</span></td>
    <td class="c-num">${Number(p.rarity_score).toFixed(1)}</td>
    <td class="c-when">${p.dead_god ? fecha(p.dead_god_at) : ""}</td>
  </tr>`;
}

async function cargarBoard(reset = false) {
  if (reset) {
    offset = 0;
    rows.innerHTML = "";
  }
  const orden = "unlocked_count.desc,rarity_score.desc,last_unlock_at.asc";
  const data = await rest(`leaderboard?select=*&order=${orden}&limit=${PAGE}&offset=${offset}`);

  if (data.length) total = data[0].total_achievements || total;

  if (!data.length && offset === 0) {
    rows.innerHTML = `<tr class="empty"><td colspan="5">Nobody here yet. Add a profile above.</td></tr>`;
  } else {
    rows.insertAdjacentHTML("beforeend", data.map(fila).join(""));
  }
  offset += data.length;
  $("#more").hidden = data.length < PAGE;
}

async function cargarStats() {
  const [s] = await rest("site_stats?select=*");
  if (!s) return;
  total = s.total_achievements || total;
  $("#stats").innerHTML = [
    ["user", s.jugadores, "players", "Players in the ranking"],
    ["skull", s.dead_gods, "dead gods", "Players with the in-game Dead God achievement"],
    ["trophy", s.completos ?? 0, `at ${total}/${total}`, "Players with every Steam achievement"],
  ]
    .map(([ic, n, l, t]) =>
      `<li title="${t}">${icono(ic, ic === "skull" ? "skull" : "")}<b>${n}</b><span>${l}</span></li>`)
    .join("");
}

// --- alta -------------------------------------------------------------------

// Cada estado es un icono y un color. El title lleva el detalle, en ingles.
const ESTADOS = {
  agregado: { c: "ok", i: "check", t: "added to the ranking" },
  actualizado: { c: "ok", i: "check", t: "updated" },
  completo: { c: "ok", i: "trophy", t: "already at 100%, nothing left to sync" },
  en_espera: { c: "warn", i: "clock", t: "updated recently, try again in an hour" },
  privado: { c: "warn", i: "lock", t: "game details are private on this profile" },
  no_existe: { c: "bad", i: "question", t: "profile not found" },
  invalido: { c: "bad", i: "x", t: "not a Steam nickname, URL or steamid64" },
  sin_logros: { c: "warn", i: "trophy", t: "no achievements unlocked yet, nothing to rank" },
  steam_saturado: { c: "bad", i: "clock", t: "Steam is rate limiting us, try again later" },
  error: { c: "bad", i: "x", t: "something failed" },
};

const msg = (clase, ic, texto, detalle, extra = "") =>
  `<div class="msg ${clase}">${icono(ic)}<b>${esc(texto)}</b><span>${esc(detalle)}</span>${extra}</div>`;

async function agregar() {
  const inputs = $("#inputs").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!inputs.length) return;

  const btn = $("#go");
  const original = btn.innerHTML;
  btn.disabled = true;
  $("#feedback").innerHTML = "";

  if (DEMO) {
    $("#feedback").innerHTML = msg("warn", "lock", "Demo mode", "the backend is not deployed");
    btn.disabled = false;
    return;
  }

  // Cada perfil nuevo se consulta uno por uno contra Steam, asi que una tanda de
  // 10 puede tardar de verdad medio minuto. Sin este aviso, el boton solo se ve
  // atenuado y sin texto: parece roto, e invita a clickear de nuevo.
  let segundos = 0;
  btn.innerHTML = `${icono("clock")}<span>Checking…</span>`;
  const tic = setInterval(() => {
    segundos++;
    if (segundos > 4) {
      btn.querySelector("span").textContent =
        inputs.length > 1 ? `Checking ${inputs.length} profiles…` : "Checking…";
    }
  }, 1000);

  try {
    const { ok, data } = await fn("add-players", { inputs });
    if (!ok) {
      const t = data.error === "rate_limit"
        ? "daily limit reached for this IP address"
        : data.detalle || data.error;
      $("#feedback").innerHTML = msg("bad", "clock", "Rejected", String(t));
      return;
    }
    $("#feedback").innerHTML = data.results
      .map((r) => {
        const e = ESTADOS[r.status] ?? ESTADOS.error;
        const extra = r.player
          ? `<span class="num">${r.player.unlocked_count}<span class="tot">/${total}</span></span>`
          : "";
        return msg(e.c, e.i, r.input, e.t, extra);
      })
      .join("");

    if (data.results.some((r) => r.status === "agregado" || r.status === "actualizado")) {
      $("#inputs").value = "";
      await Promise.all([cargarStats(), cargarBoard(true)]);
    }
  } catch (e) {
    $("#feedback").innerHTML = msg("bad", "x", "Connection failed", e.message);
  } finally {
    clearInterval(tic);
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// --- detalle ----------------------------------------------------------------

let catalogo = null;
async function getCatalogo() {
  if (!catalogo) {
    catalogo = await rest(
      "achievements?select=apiname,bit_index,name,description,icon,global_pct&order=bit_index",
    );
  }
  return catalogo;
}

async function abrirDetalle(steamid64) {
  const dlg = $("#detail");
  $("#detail-body").innerHTML = "";
  dlg.showModal();

  const campos = "display_name,avatar,unlocked,unlocked_count,rarity_score,is_complete,dead_god,dead_god_at,first_unlock_at,last_unlock_at,custom_url";
  const [[p], cat] = await Promise.all([
    rest(`players?select=${campos}&steamid64=eq.${encodeURIComponent(steamid64)}`),
    getCatalogo(),
  ]);
  if (!p) {
    $("#detail-body").innerHTML = "Not found.";
    return;
  }

  const mask = p.unlocked || "";
  const tiene = cat.filter((a) => mask[a.bit_index] === "1");
  const raros = [...tiene].sort((a, b) => a.global_pct - b.global_pct).slice(0, 8);
  const perfil = p.custom_url
    ? `https://steamcommunity.com/id/${encodeURIComponent(p.custom_url)}`
    : `https://steamcommunity.com/profiles/${steamid64}`;

  // Primer logro, ultimo, y la fecha de Dead God si la tiene.
  const fechas = [
    `<span>First achievement <b>${fecha(p.first_unlock_at)}</b></span>`,
    `<span>Latest <b>${fecha(p.last_unlock_at)}</b></span>`,
    p.dead_god
      ? `<span class="dg">${icono("skull", "skull")} Dead God <b>${fecha(p.dead_god_at)}</b></span>`
      : "",
  ].join("");

  $("#detail-body").innerHTML = `
    <div class="who big">
      ${avatar(p.avatar, 44)}
      <div>
        <h2>${esc(p.display_name)}
          ${p.dead_god ? `<span class="tag" title="Unlocked the in-game Dead God achievement">${icono("skull", "skull")} dead god</span>` : ""}
          ${p.is_complete ? `<span class="tag full" title="Has every Steam achievement">${total}/${total}</span>` : ""}
        </h2>
        <div class="nums">
          <span title="Achievements unlocked">${icono("trophy")}${p.unlocked_count}<span class="tot">/${total}</span></span>
          <span title="Rarity score">${icono("gem", "gem")}${Number(p.rarity_score).toFixed(1)} rarity</span>
        </div>
      </div>
      <a href="${perfil}" target="_blank" rel="noopener" class="ext">${icono("link")} Steam</a>
    </div>

    <p class="fechas">${fechas}</p>

    <h3>${icono("gem", "gem")} Rarest achievements owned</h3>
    <ul class="rare-list">
      ${raros
        .map(
          (a) => `
        <li>
          ${avatar(a.icon, 26)}
          <div><b>${esc(a.name)}</b><small>${esc(a.description)}</small></div>
          <em>${Number(a.global_pct).toFixed(1)}%</em>
        </li>`,
        )
        .join("")}
    </ul>`;
}

// --- eventos ----------------------------------------------------------------

$("#go").addEventListener("click", agregar);
$("#inputs").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) agregar();
});
$("#more").addEventListener("click", () => cargarBoard());
$("#close").addEventListener("click", () => $("#detail").close());
rows.addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (tr) abrirDetalle(tr.dataset.id);
});

if (DEMO) {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div class="banner">${icono("lock")}
       DEMO MODE &middot; no backend connected. Rows tagged <b>demo</b> are synthetic;
       everything else is real Steam data.
     </div>`,
  );
}

cargarStats().catch(() => {});
cargarBoard(true).catch((e) => {
  rows.innerHTML = `<tr class="empty"><td colspan="5">Could not load the ranking. ${esc(e.message)}</td></tr>`;
});
