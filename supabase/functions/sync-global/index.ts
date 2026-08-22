// Cron diario. Refresca el % global de cada logro y recalcula los scores.
// La primera corrida ademas siembra el catalogo (nombres, iconos, orden) leyendo
// un perfil de referencia que este al 100%, porque el endpoint de porcentajes
// devuelve solo apiname + pct, sin metadata.

import { fetchGlobalPercents, fetchStats, parseInput } from "../_shared/steam.ts";
import { admin, ensureAchievements, json, loadCatalog } from "../_shared/db.ts";

const REF = Deno.env.get("REFERENCE_PROFILE") ?? "bisnap";

Deno.serve(async () => {
  const db = admin();
  let cat = await loadCatalog(db);
  let sembrados = 0;

  if (cat.total === 0) {
    const target = parseInput(REF);
    if (!target) return json({ error: "reference_profile_invalido", REF }, 500);
    const stats = await fetchStats(target);
    if (stats.achievements.length === 0) {
      return json({ error: "reference_profile_sin_logros", REF }, 500);
    }
    cat = await ensureAchievements(db, stats.achievements, cat);
    sembrados = cat.total;
  }

  const pcts = await fetchGlobalPercents();
  const payload = Object.entries(pcts).map(([apiname, pct]) => ({ apiname, pct }));

  const { data: actualizados, error } = await db.rpc("apply_global_pcts", { p: payload });
  if (error) return json({ error: error.message }, 500);

  const { error: e2 } = await db.rpc("rescore_all");
  if (e2) return json({ error: e2.message }, 500);

  return json({ sembrados, actualizados, total: cat.total });
});
