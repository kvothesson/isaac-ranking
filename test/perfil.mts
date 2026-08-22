// Consulta un perfil en vivo y muestra lo que veria el ranking, sin tocar Supabase.
// Sirve para probar antes de desplegar y para chequear un caso raro.
//
//   node --experimental-strip-types --no-warnings test/perfil.mts 3ezee
//   node --experimental-strip-types --no-warnings test/perfil.mts https://steamcommunity.com/id/bisnap/

import { fetchGlobalPercents, fetchStats, parseInput } from "../supabase/functions/_shared/steam.ts";

const entrada = process.argv[2];
if (!entrada) {
  console.error("uso: perfil.mts <nick | steamid64 | url del perfil>");
  process.exit(1);
}

const target = parseInput(entrada);
if (!target) {
  console.error(`"${entrada}" no parece un nick ni un link de Steam`);
  process.exit(1);
}

const [stats, pct] = await Promise.all([fetchStats(target), fetchGlobalPercents()]);

if (stats.private) {
  console.log("PERFIL PRIVADO. Hay que poner los detalles de juego en publico.");
  process.exit(0);
}

const total = stats.achievements.length;
const tiene = stats.achievements.filter((a) => a.closed);
const peso = (apiname: string) => Math.log10(100 / Math.max(pct[apiname] ?? 100, 0.001));
const score = tiene.reduce((s, a) => s + peso(a.apiname), 0);
const maximo = stats.achievements.reduce((s, a) => s + peso(a.apiname), 0);
const dia = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const ts = tiene.map((a) => a.unlockedAt!).filter(Boolean).sort((a, b) => a - b);

console.log(`steamid64 : ${stats.steamid64}`);
console.log(`vanity    : ${stats.customUrl ?? "-"}`);
console.log(`logros    : ${tiene.length}/${total}${tiene.length === total ? "   *** DEAD GOD ***" : ""}`);
console.log(`rareza    : ${score.toFixed(1)} de ${maximo.toFixed(1)} posibles`);
if (ts.length) {
  console.log(`primero   : ${dia(ts[0])}`);
  console.log(`ultimo    : ${dia(ts[ts.length - 1])}`);
}

const raros = tiene
  .map((a) => ({ name: a.name, p: pct[a.apiname] ?? 100 }))
  .sort((a, b) => a.p - b.p)
  .slice(0, 8);
console.log("\nsus logros mas raros:");
for (const r of raros) console.log(`  ${r.p.toFixed(1).padStart(5)}%  ${r.name}`);

const faltan = stats.achievements
  .filter((a) => !a.closed)
  .map((a) => ({ name: a.name, p: pct[a.apiname] ?? 100 }))
  .sort((a, b) => b.p - a.p)
  .slice(0, 5);
if (faltan.length) {
  console.log("\nlo mas facil que le falta:");
  for (const r of faltan) console.log(`  ${r.p.toFixed(1).padStart(5)}%  ${r.name}`);
}
