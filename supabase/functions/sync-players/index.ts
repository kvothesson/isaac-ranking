// Cron. Refresca jugadores por tanda: el top a diario, el resto semanal.
// Los Dead God quedan congelados (players_to_sync los excluye) porque ya no
// pueden subir mas.

import { fetchProfile, fetchStats, sleep } from "../_shared/steam.ts";
import { admin, ensureAchievements, json, loadCatalog, upsertPlayer } from "../_shared/db.ts";

const TANDA = Number(Deno.env.get("SYNC_BATCH") ?? "20");

Deno.serve(async () => {
  const db = admin();
  const { data: ids, error } = await db.rpc("players_to_sync", { p_limit: TANDA });
  if (error) return json({ error: error.message }, 500);
  if (!ids?.length) return json({ sincronizados: 0, detalle: "nada pendiente" });

  let cat = await loadCatalog(db);
  const out: unknown[] = [];

  for (const [i, steamid64] of (ids as string[]).entries()) {
    if (i > 0) await sleep(600);
    try {
      const stats = await fetchStats({ kind: "id", value: steamid64 });
      if (stats.private) {
        await db.from("players").update({ private: true, last_sync: new Date().toISOString() })
          .eq("steamid64", steamid64);
        out.push({ steamid64, status: "privado" });
        continue;
      }
      cat = await ensureAchievements(db, stats.achievements, cat);
      const profile = await fetchProfile(stats.steamid64);
      const p = await upsertPlayer(db, stats, profile, cat);
      out.push({ steamid64, status: "ok", logros: p.unlocked_count });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      out.push({ steamid64, status: "error", detalle: msg });
      if (msg === "steam_rate_limited") break;
    }
  }

  return json({ sincronizados: out.length, out });
});
