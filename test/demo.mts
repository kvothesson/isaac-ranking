// Genera web/demo.json: deja ver el sitio funcionando sin Supabase desplegado.
//
//   node --experimental-strip-types --no-warnings test/demo.mts
//
// Los perfiles reales se bajan en vivo de Steam. Los sinteticos existen solo
// para que se vea el desempate por rareza con el ranking vacio, y van marcados
// como tales: el sitio muestra un cartel de MODO DEMO cuando carga este archivo.

import { writeFileSync } from "node:fs";
import { DEAD_GOD, fetchGlobalPercents, fetchProfile, fetchStats, parseInput, sleep } from "../supabase/functions/_shared/steam.ts";

const REALES = ["bisnap", "3ezee"];

const pct = await fetchGlobalPercents();

// El catalogo sale del perfil completo: es el unico que tiene los 641 con metadata.
const base = await fetchStats(parseInput("bisnap")!);
const catalogo = base.achievements.map((a, i) => ({
  apiname: a.apiname,
  bit_index: i,
  name: a.name,
  description: a.description,
  icon: a.icon,
  global_pct: pct[a.apiname] ?? 100,
}));
const total = catalogo.length;
const peso = (apiname: string) => Math.log10(100 / Math.max(pct[apiname] ?? 100, 0.001));

type Fila = {
  steamid64: string; custom_url: string | null; display_name: string; avatar: string | null;
  unlocked: string; unlocked_count: number; rarity_score: number; is_complete: boolean;
  dead_god: boolean; dead_god_at: string | null;
  first_unlock_at: string | null; last_unlock_at: string | null; sintetico: boolean;
};

const armar = (
  id: string, nombre: string, avatar: string | null, vanity: string | null,
  indices: Set<number>, desde: string, hasta: string, sintetico: boolean,
): Fila => {
  const mask = catalogo.map((a) => (indices.has(a.bit_index) ? "1" : "0")).join("");
  const score = catalogo.filter((a) => indices.has(a.bit_index)).reduce((s, a) => s + peso(a.apiname), 0);
  const bitDG = catalogo.find((a) => a.apiname === DEAD_GOD)!.bit_index;
  const dead_god = indices.has(bitDG);
  return {
    dead_god, dead_god_at: dead_god ? hasta : null,
    steamid64: id, custom_url: vanity, display_name: nombre, avatar,
    unlocked: mask, unlocked_count: indices.size, rarity_score: Number(score.toFixed(4)),
    is_complete: indices.size === total,
    first_unlock_at: indices.size ? desde : null,
    last_unlock_at: indices.size ? hasta : null,
    sintetico,
  };
};

const filas: Fila[] = [];

for (const [i, nick] of REALES.entries()) {
  if (i > 0) await sleep(500);
  const stats = await fetchStats(parseInput(nick)!);
  const perfil = await fetchProfile(stats.steamid64);
  const tiene = stats.achievements.filter((a) => a.closed);
  const idx = new Set(stats.achievements.map((a, j) => (a.closed ? j : -1)).filter((j) => j >= 0));
  const ts = tiene.map((a) => a.unlockedAt!).filter(Boolean).sort((a, b) => a - b);
  filas.push(armar(
    stats.steamid64, perfil.name || nick, perfil.avatar || null, stats.customUrl,
    idx,
    new Date(ts[0] * 1000).toISOString(),
    new Date(ts[ts.length - 1] * 1000).toISOString(),
    false,
  ));
  console.log(`real: ${nick} -> ${idx.size}/${total}`);
}

// Orden de dificultad real: primero los que tiene mas gente.
const porFacilidad = [...catalogo].sort((a, b) => b.global_pct - a.global_pct).map((a) => a.bit_index);

// Sinteticos. El par de 380 es el que importa: misma cantidad, distinta rareza.
const nDe = (n: number) => new Set(porFacilidad.slice(0, n));
const conRaros = (n: number, extra: number) => {
  const s = new Set(porFacilidad.slice(0, n - extra));
  for (const b of porFacilidad.slice(-extra)) s.add(b); // los mas raros del juego
  return s;
};

const sinteticos: [string, Set<number>, string][] = [
  ["demo_dead_god", new Set(porFacilidad), "2026-02-03T18:00:00.000Z"],
  ["demo_va_saliendo", nDe(505), "2026-07-11T21:00:00.000Z"],
  // este tiene el logro Dead God (esta entre los mas raros) pero no los 641
  ["demo_empate_rarezaA", conRaros(380, 60), "2026-06-02T14:00:00.000Z"],
  ["demo_empate_rarezaB", nDe(380), "2026-06-20T14:00:00.000Z"],
  ["demo_a_mitad", nDe(240), "2026-05-05T12:00:00.000Z"],
  ["demo_arrancando", nDe(48), "2026-08-14T20:00:00.000Z"],
  ["demo_recien_instalado", new Set<number>(), ""],
];

for (const [nombre, idx, hasta] of sinteticos) {
  filas.push(armar(`demo-${nombre}`, nombre, null, null, idx, "2015-03-01T00:00:00.000Z", hasta, true));
}

// Mismo orden que la vista leaderboard de Postgres.
filas.sort((a, b) =>
  b.unlocked_count - a.unlocked_count ||
  b.rarity_score - a.rarity_score ||
  String(a.last_unlock_at).localeCompare(String(b.last_unlock_at))
);

let rank = 0, prevC = -1, prevR = -1;
const leaderboard = filas.map((f, i) => {
  if (f.unlocked_count !== prevC || f.rarity_score !== prevR) { rank = i + 1; prevC = f.unlocked_count; prevR = f.rarity_score; }
  return { ...f, rank, total_achievements: total };
});

writeFileSync("web/demo.json", JSON.stringify({
  demo: true,
  generado: new Date().toISOString(),
  site_stats: {
    jugadores: filas.length,
    dead_gods: filas.filter((f) => f.dead_god).length,
    completos: filas.filter((f) => f.is_complete).length,
    total_achievements: total,
    ultima_sync: new Date().toISOString(),
  },
  leaderboard,
  achievements: catalogo,
}, null, 0));

console.log(`\nweb/demo.json: ${leaderboard.length} jugadores, ${total} logros`);
for (const f of leaderboard) {
  console.log(`  ${String(f.rank).padStart(2)}. ${f.display_name.padEnd(22)} ${String(f.unlocked_count).padStart(3)}/${total}  rareza ${f.rarity_score.toFixed(1).padStart(6)}  ${f.dead_god ? "DEAD GOD" : "        "}${f.sintetico ? "" : "  <- real"}`);
}
