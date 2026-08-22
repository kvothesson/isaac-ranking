// Sugiere que logros encarar despues, comparando contra jugadores que ya
// completaron el juego.
//
//   node --experimental-strip-types --no-warnings test/path.mts <yo> <referencia...>
//
// La idea: en Isaac muchos logros estan encadenados (para hacer X primero hay
// que desbloquear Y). Ese orden no esta escrito en ningun lado, pero si mirás
// CUANDO lo saco cada completionista, el orden aparece solo. Para cada logro se
// calcula en que punto de su progreso lo consiguio la gente que ya termino, y
// eso da una nocion de "etapa" mucho mejor que el porcentaje global.

import { fetchGlobalPercents, fetchStats, parseInput, sleep } from "../supabase/functions/_shared/steam.ts";

const [yoArg, ...refArgs] = process.argv.slice(2);
if (!yoArg || refArgs.length === 0) {
  console.error("uso: path.mts <tu-perfil> <perfil-referencia> [mas referencias...]");
  process.exit(1);
}

const pct = await fetchGlobalPercents();

const bajar = async (arg: string) => {
  const t = parseInput(arg);
  if (!t) throw new Error(`no se entiende: ${arg}`);
  const s = await fetchStats(t);
  if (s.private) throw new Error(`perfil privado: ${arg}`);
  return s;
};

const yo = await bajar(yoArg);
const total = yo.achievements.length;
const mios = new Set(yo.achievements.filter((a) => a.closed).map((a) => a.apiname));
console.log(`vos: ${mios.size}/${total} logros\n`);

// Para cada referencia, en que fraccion de SU progreso saco cada logro.
// 0.0 = de los primeros que consiguio, 1.0 = de los ultimos.
const etapas = new Map<string, number[]>();
const refs: { nombre: string; n: number }[] = [];

for (const [i, arg] of refArgs.entries()) {
  if (i > 0) await sleep(600);
  const r = await bajar(arg);
  const conFecha = r.achievements
    .filter((a) => a.closed && a.unlockedAt)
    .sort((a, b) => a.unlockedAt! - b.unlockedAt!);
  refs.push({ nombre: r.customUrl ?? r.steamid64, n: conFecha.length });
  conFecha.forEach((a, idx) => {
    const arr = etapas.get(a.apiname) ?? [];
    arr.push(idx / conFecha.length);
    etapas.set(a.apiname, arr);
  });
  console.log(`referencia ${r.customUrl ?? r.steamid64}: ${conFecha.length}/${total}`);
}

const prom = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Lo que te falta, con la etapa tipica en que lo saca el resto.
const faltan = yo.achievements
  .filter((a) => !mios.has(a.apiname))
  .map((a) => {
    const e = etapas.get(a.apiname);
    return {
      name: a.name,
      description: a.description,
      pct: pct[a.apiname] ?? 100,
      etapa: e ? prom(e) : null,   // null = ninguna referencia lo tiene
    };
  });

console.log(`\nte faltan ${faltan.length} logros\n`);

// Los que la gente saca temprano y vos todavia no tenes: es la fruta baja.
const conEtapa = faltan.filter((f) => f.etapa !== null) as (typeof faltan[0] & { etapa: number })[];
conEtapa.sort((a, b) => a.etapa - b.etapa);

const linea = (f: typeof conEtapa[0]) =>
  `  ${(f.etapa * 100).toFixed(0).padStart(3)}%  ${f.pct.toFixed(1).padStart(5)}%  ${f.name}${f.description ? "  ::  " + f.description.slice(0, 60) : ""}`;

console.log("=".repeat(78));
console.log("EMPEZA POR ACA: lo que casi todos sacan temprano y vos no tenes");
console.log("etapa = en que punto de su progreso lo saco la gente que ya termino");
console.log("global = cuanta gente en Steam lo tiene");
console.log("=".repeat(78));
console.log("etapa  global  logro");
conEtapa.slice(0, 25).forEach((f) => console.log(linea(f)));

console.log("\n" + "=".repeat(78));
console.log("LO QUE DEJAN PARA EL FINAL (los mas duros, para despues)");
console.log("=".repeat(78));
conEtapa.slice(-10).forEach((f) => console.log(linea(f)));

// Reparto por tramos, para ver cuanto te falta de cada etapa.
console.log("\n" + "=".repeat(78));
console.log("COMO SE REPARTE LO QUE TE FALTA");
console.log("=".repeat(78));
const tramos = [
  ["primer cuarto  ", 0, 0.25],
  ["segundo cuarto ", 0.25, 0.5],
  ["tercer cuarto  ", 0.5, 0.75],
  ["ultimo cuarto  ", 0.75, 1.01],
] as const;
for (const [etiqueta, lo, hi] of tramos) {
  const n = conEtapa.filter((f) => f.etapa >= lo && f.etapa < hi).length;
  const barra = "#".repeat(Math.round(n / 3));
  console.log(`${etiqueta} ${String(n).padStart(3)}  ${barra}`);
}

const sinDato = faltan.filter((f) => f.etapa === null);
if (sinDato.length) {
  console.log(`\n(${sinDato.length} logros que te faltan no los tiene ninguna referencia)`);
  sinDato.slice(0, 10).forEach((f) => console.log(`  ${f.pct.toFixed(1).padStart(5)}%  ${f.name}`));
}
