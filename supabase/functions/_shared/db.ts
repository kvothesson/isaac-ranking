import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { DEAD_GOD } from "./steam.ts";
import type { Ach, PlayerStats } from "./steam.ts";

export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export type Catalog = { index: Map<string, number>; total: number };

export async function loadCatalog(db: SupabaseClient): Promise<Catalog> {
  const index = new Map<string, number>();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("achievements").select("apiname,bit_index")
      .order("bit_index").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) index.set(r.apiname, r.bit_index);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return { index, total: index.size };
}

// Si Steam agrega logros nuevos (pasa con cada DLC) aparecen en el XML antes que
// en nuestra tabla. Se les asigna un bit_index nuevo al final y no se toca ninguno
// de los existentes, porque los bitmask viejos quedarian corridos.
export async function ensureAchievements(
  db: SupabaseClient, achs: Ach[], cat: Catalog,
): Promise<Catalog> {
  const missing = achs.filter((a) => !cat.index.has(a.apiname));
  if (missing.length === 0) return cat;

  let next = cat.total === 0 ? 0 : Math.max(...cat.index.values()) + 1;
  const rows = missing.map((a) => ({
    apiname: a.apiname,
    bit_index: next++,
    name: a.name || a.apiname,
    description: a.description,
    icon: a.icon,
  }));

  const { error } = await db.from("achievements").upsert(rows, { onConflict: "apiname" });
  if (error) throw new Error(error.message);
  return await loadCatalog(db);
}

// Un caracter por logro, posicionado por bit_index. 641 logros = 641 chars,
// que Postgres guarda como 641 bits (81 bytes).
export function buildMask(achs: Ach[], cat: Catalog): string {
  const bits = new Array<string>(cat.total).fill("0");
  for (const a of achs) {
    if (!a.closed) continue;
    const i = cat.index.get(a.apiname);
    if (i !== undefined && i < bits.length) bits[i] = "1";
  }
  return bits.join("");
}

const iso = (s: number | null) => (s ? new Date(s * 1000).toISOString() : null);

export async function upsertPlayer(
  db: SupabaseClient, stats: PlayerStats, profile: { name: string; avatar: string }, cat: Catalog,
) {
  const unlocked = stats.achievements.filter((a) => a.closed && a.unlockedAt);
  const times = unlocked.map((a) => a.unlockedAt!).sort((a, b) => a - b);

  // Cuando consiguio el logro Dead God. El trigger deriva el booleano del bitmask,
  // pero la fecha solo la sabe el XML.
  const dg = stats.achievements.find((a) => a.apiname === DEAD_GOD && a.closed);

  const row = {
    steamid64: stats.steamid64,
    custom_url: stats.customUrl,
    display_name: profile.name || stats.customUrl || stats.steamid64,
    avatar: profile.avatar || null,
    unlocked: buildMask(stats.achievements, cat),
    first_unlock_at: iso(times[0] ?? null),
    last_unlock_at: iso(times[times.length - 1] ?? null),
    dead_god_at: iso(dg?.unlockedAt ?? null),
    private: stats.private,
    last_sync: new Date().toISOString(),
  };

  const { data, error } = await db
    .from("players").upsert(row, { onConflict: "steamid64" })
    .select("steamid64,display_name,avatar,unlocked_count,rarity_score,is_complete,dead_god,dead_god_at,last_unlock_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const salt = Deno.env.get("IP_SALT") ?? "isaac";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ip));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
