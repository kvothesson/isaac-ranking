// POST { inputs: ["nick", "https://steamcommunity.com/id/otro", "7656119..."] }
// Da de alta o refresca jugadores. Sin login: solo hace falta el nick.

import { fetchProfile, fetchStats, parseInput, sleep } from "../_shared/steam.ts";
import { CORS, admin, ensureAchievements, hashIp, json, loadCatalog, upsertPlayer } from "../_shared/db.ts";

const MAX_POR_REQUEST = 10;
const MAX_POR_DIA = 30;
const COOLDOWN_MIN = 60; // un jugador no completo se puede refrescar 1 vez por hora

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let inputs: string[];
  try {
    const body = await req.json();
    inputs = (Array.isArray(body?.inputs) ? body.inputs : [body?.input])
      .filter((s: unknown): s is string => typeof s === "string" && s.trim() !== "");
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  inputs = [...new Set(inputs.map((s) => s.trim()))];
  if (inputs.length === 0) return json({ error: "sin_nicks" }, 400);
  if (inputs.length > MAX_POR_REQUEST) {
    return json({ error: "demasiados", detalle: `maximo ${MAX_POR_REQUEST} por vez` }, 400);
  }

  const db = admin();
  const ip = await hashIp(req);

  const { data: usados } = await db.rpc("submissions_today", { p_ip: ip });
  if ((usados ?? 0) + inputs.length > MAX_POR_DIA) {
    return json({ error: "rate_limit", detalle: `${MAX_POR_DIA} altas por dia por IP`, usados }, 429);
  }

  let cat = await loadCatalog(db);
  const results: unknown[] = [];

  for (const [i, input] of inputs.entries()) {
    const target = parseInput(input);
    if (!target) {
      results.push({ input, status: "invalido", detalle: "no parece un nick ni un link de Steam" });
      continue;
    }

    try {
      // Si ya lo tenemos, decidimos si vale la pena volver a pegarle a Steam.
      const col = target.kind === "id" ? "steamid64" : "custom_url";
      const { data: prev } = await db.from("players")
        .select("steamid64,display_name,avatar,unlocked_count,rarity_score,is_complete,dead_god,dead_god_at,last_unlock_at,last_sync")
        .eq(col, target.value).maybeSingle();

      if (prev?.is_complete) {
        results.push({ input, status: "completo", detalle: "Dead God, ya no hace falta refrescar", player: prev });
        continue;
      }
      if (prev && Date.now() - new Date(prev.last_sync).getTime() < COOLDOWN_MIN * 60_000) {
        results.push({ input, status: "en_espera", detalle: `se refresca 1 vez por hora`, player: prev });
        continue;
      }

      if (i > 0) await sleep(400); // no le pegamos a Steam de golpe

      const stats = await fetchStats(target);
      if (stats.private) {
        results.push({ input, status: "privado", detalle: "el perfil tiene los detalles de juego en privado" });
        await db.from("submissions").insert({ ip_hash: ip, input, ok: false });
        continue;
      }

      // 0/641 es un perfil valido pero no aporta nada al ranking: se rechaza en
      // el alta para que la tabla no se llene de filas vacias. Un jugador que ya
      // estaba cargado y sigue en 0 no se toca aca (eso lo maneja el cron).
      if (!prev && stats.achievements.every((a) => !a.closed)) {
        results.push({ input, status: "sin_logros", detalle: "el perfil no tiene ningun logro desbloqueado" });
        await db.from("submissions").insert({ ip_hash: ip, input, ok: false });
        continue;
      }

      cat = await ensureAchievements(db, stats.achievements, cat);
      const profile = await fetchProfile(stats.steamid64);
      const player = await upsertPlayer(db, stats, profile, cat);

      await db.from("submissions").insert({ ip_hash: ip, input, ok: true });
      results.push({ input, status: prev ? "actualizado" : "agregado", player });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      const status = msg === "profile_not_found" ? "no_existe"
        : msg === "steam_rate_limited" ? "steam_saturado" : "error";
      results.push({ input, status, detalle: msg });
      await db.from("submissions").insert({ ip_hash: ip, input, ok: false });
      if (status === "steam_saturado") break; // no insistas, cortala
    }
  }

  return json({ results, total_achievements: cat.total });
});
