export interface Route { seg: string[]; qs: URLSearchParams }

/** "#/series/Ice%20Cream%20Man?x=1" → { seg: ["series", "Ice Cream Man"], qs } */
export function parseHash(hash: string): Route {
  const raw = String(hash).replace(/^#/, "") || "/";
  const qi = raw.indexOf("?");
  const path = qi < 0 ? raw : raw.slice(0, qi);
  const seg = path.split("/").filter(Boolean).map(s => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  return { seg, qs: new URLSearchParams(qi < 0 ? "" : raw.slice(qi + 1)) };
}

export function href(path: string, qs?: Record<string, string>): string {
  const entries = Object.entries(qs ?? {}).filter(([, v]) => v !== "" && v != null);
  if (!entries.length) return "#" + path;
  return "#" + path + "?" + new URLSearchParams(entries).toString();
}

export function go(path: string, qs?: Record<string, string>): void {
  location.hash = href(path, qs).slice(1);
}

/** Fires immediately with the current route, then on every hash change. */
export function onRoute(cb: (r: Route) => void): void {
  const fire = () => cb(parseHash(location.hash));
  window.addEventListener("hashchange", fire);
  fire();
}
