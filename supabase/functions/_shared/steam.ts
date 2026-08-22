// Lectura de datos publicos de Steam. No usa API key: el XML de la comunidad
// alcanza para todo lo que necesitamos y no pide autenticacion.

export const APPID = "250900"; // The Binding of Isaac: Rebirth

// El logro que da el juego al completar todas las marcas. Lo tiene el 3,4% de los
// jugadores y no equivale a tener los 641 de Steam.
export const DEAD_GOD = "637";
const UA = "isaac-ranking/1.0 (+https://github.com/kvothesson/isaac-ranking)";

export type Ach = {
  apiname: string;
  name: string;
  description: string;
  icon: string;
  closed: boolean;
  unlockedAt: number | null; // unix seconds
};

export type PlayerStats = {
  steamid64: string;
  customUrl: string | null;
  private: boolean;
  achievements: Ach[];
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'",
};

function clean(raw: string | null): string {
  if (!raw) return "";
  let s = raw.trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) s = cdata[1];
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m).trim();
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp("<" + name + ">([^]*?)</" + name + ">"));
  return clean(m ? m[1] : null);
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/xml" } });
  if (res.status === 429) throw new Error("steam_rate_limited");
  if (!res.ok) throw new Error(`steam_http_${res.status}`);
  return await res.text();
}

// Acepta: URL completa del perfil, custom URL suelta, o steamid64.
export function parseInput(raw: string): { kind: "id" | "vanity"; value: string } | null {
  let s = raw.trim();
  if (!s) return null;

  const urlMatch = s.match(/steamcommunity\.com\/(id|profiles)\/([^/?#\s]+)/i);
  if (urlMatch) {
    const value = decodeURIComponent(urlMatch[2]);
    return urlMatch[1].toLowerCase() === "profiles"
      ? { kind: "id", value }
      : { kind: "vanity", value };
  }

  s = s.replace(/^@/, "").replace(/\/+$/, "");
  if (/^7656119\d{10}$/.test(s)) return { kind: "id", value: s };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(s)) return { kind: "vanity", value: s };
  return null;
}

export function statsUrl(t: { kind: string; value: string }): string {
  const base = t.kind === "id" ? "profiles" : "id";
  return `https://steamcommunity.com/${base}/${encodeURIComponent(t.value)}/stats/${APPID}/?xml=1`;
}

export function profileUrl(steamid64: string): string {
  return `https://steamcommunity.com/profiles/${steamid64}/?xml=1`;
}

export async function fetchStats(target: { kind: "id" | "vanity"; value: string }): Promise<PlayerStats> {
  return parseStatsXml(await get(statsUrl(target)));
}

export function parseStatsXml(xml: string): PlayerStats {
  // Perfil que no existe: por vanity Steam devuelve <response><error>, y por
  // steamid64 inventado devuelve directamente una pagina HTML de error.
  if (!/<playerstats/i.test(xml) || /<error>/i.test(xml)) {
    throw new Error("profile_not_found");
  }

  // Perfil privado: la respuesta trae SOLO privacyState, ni steamid64 ni logros.
  if (tag(xml, "privacyState").toLowerCase() !== "public") {
    return { steamid64: "", customUrl: null, private: true, achievements: [] };
  }

  const playerBlock = xml.match(/<player>([\s\S]*?)<\/player>/)?.[1] ?? "";
  const steamid64 = tag(playerBlock, "steamID64");
  if (!steamid64) throw new Error("profile_not_found");
  const achievements: Ach[] = [];

  const block = xml.match(/<achievements>([\s\S]*?)<\/achievements>/)?.[1] ?? "";
  const re = /<achievement\b[^>]*closed="(\d)"[^>]*>([\s\S]*?)<\/achievement>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const inner = m[2];
    const apiname = tag(inner, "apiname");
    if (!apiname) continue;
    const ts = tag(inner, "unlockTimestamp");
    achievements.push({
      apiname,
      name: tag(inner, "name"),
      description: tag(inner, "description"),
      icon: tag(inner, "iconClosed"),
      closed: m[1] === "1",
      unlockedAt: ts ? parseInt(ts, 10) : null,
    });
  }

  return {
    steamid64,
    customUrl: tag(playerBlock, "customURL") || null,
    private: false,
    achievements,
  };
}

export async function fetchProfile(steamid64: string): Promise<{ name: string; avatar: string }> {
  try {
    const xml = await get(profileUrl(steamid64));
    return { name: tag(xml, "steamID"), avatar: tag(xml, "avatarMedium") };
  } catch {
    return { name: "", avatar: "" }; // el nombre es cosmetico, no rompemos el alta por esto
  }
}

// Porcentajes globales de cada logro. Tampoco pide API key.
export async function fetchGlobalPercents(): Promise<Record<string, number>> {
  const res = await fetch(
    `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${APPID}`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) throw new Error(`steam_http_${res.status}`);
  const json = await res.json();
  const out: Record<string, number> = {};
  for (const a of json?.achievementpercentages?.achievements ?? []) {
    out[a.name] = parseFloat(a.percent);
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
