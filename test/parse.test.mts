import { readFileSync } from "node:fs";
import { parseStatsXml, parseInput } from "../supabase/functions/_shared/steam.ts";

const DIR = process.argv[2] ?? new URL("./fixtures", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
let fallos = 0;
const ok = (cond: unknown, label: string, extra = "") => {
  if (!cond) fallos++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`);
};

// --- parseInput -------------------------------------------------------------
const casos: [string, string | null, string][] = [
  ["bisnap", "vanity", "bisnap"],
  ["  BiSnap  ", "vanity", "BiSnap"],
  ["https://steamcommunity.com/id/bisnap/", "vanity", "bisnap"],
  ["https://steamcommunity.com/id/bisnap/stats/250900/", "vanity", "bisnap"],
  ["steamcommunity.com/profiles/76561197999501352", "id", "76561197999501352"],
  ["76561197999501352", "id", "76561197999501352"],
  ["@bisnap", "vanity", "bisnap"],
  ["nick con espacios", null, ""],
  ["", null, ""],
];
for (const [input, kind, value] of casos) {
  const r = parseInput(input);
  ok(kind === null ? r === null : r?.kind === kind && r?.value === value,
     `parseInput(${JSON.stringify(input)})`, JSON.stringify(r));
}

// --- parseStatsXml sobre XML real de Steam ----------------------------------
const bisnap = parseStatsXml(readFileSync(`${DIR}/p_bisnap.xml`, "utf8"));
ok(bisnap.steamid64 === "76561197999501352", "bisnap steamid64", bisnap.steamid64);
ok(bisnap.customUrl === "bisnap", "bisnap customUrl", String(bisnap.customUrl));
ok(bisnap.private === false, "bisnap publico");
ok(bisnap.achievements.length === 641, "bisnap 641 logros", String(bisnap.achievements.length));
const cerrados = bisnap.achievements.filter((a) => a.closed);
ok(cerrados.length === 641, "bisnap 641/641 desbloqueados", String(cerrados.length));
ok(cerrados.every((a) => a.unlockedAt && a.unlockedAt > 1_400_000_000), "todos con unlockTimestamp");
const deadGod = new Date(Math.max(...cerrados.map((a) => a.unlockedAt!)) * 1000);
ok(deadGod.getUTCFullYear() === 2025 && deadGod.getUTCMonth() === 8, "dead god sep-2025", deadGod.toISOString());
const magda = bisnap.achievements.find((a) => a.apiname === "1");
ok(magda?.name === "Magdalene", "metadata del logro 1", magda?.name);
ok(!!magda?.icon?.startsWith("https://"), "icono absoluto", magda?.icon?.slice(0, 40));
ok(bisnap.achievements.every((a) => !/&(amp|lt|gt|quot);/.test(a.description)), "sin entidades sin decodificar");

const st4ck = parseStatsXml(readFileSync(`${DIR}/st4ck.xml`, "utf8"));
ok(st4ck.achievements.length > 0, "st4ck lista logros", String(st4ck.achievements.length));
ok(st4ck.achievements.filter((a) => a.closed).length === 0, "st4ck 0 desbloqueados");
ok(st4ck.private === false, "st4ck publico con 0/641, no es privado");

const priv = parseStatsXml(readFileSync(`${DIR}/p_sinvicta.xml`, "utf8"));
ok(priv.private === true, "sinvicta privado");
ok(priv.achievements.length === 0, "sinvicta sin logros");

const tira = (archivo: string) => {
  try { parseStatsXml(readFileSync(`${DIR}/${archivo}`, "utf8")); return null; }
  catch (e) { return (e as Error).message; }
};
ok(tira("noexiste.xml") === "profile_not_found", "vanity inexistente -> not_found", String(tira("noexiste.xml")));
ok(tira("noid.xml") === "profile_not_found", "steamid64 inexistente (HTML) -> not_found", String(tira("noid.xml")));

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
