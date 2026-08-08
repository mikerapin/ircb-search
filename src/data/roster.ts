export interface Panelist { name: string; display: string; tagline: string; photo: string; aliases?: string[] }

/* Self-hosted: these used to load from Mike's Squarespace CDN, which meant a redesign of
   ircbpodcast.com would silently blank the facet rail and the panel grid. 500px WebP,
   relative paths so they resolve under any deploy base. */

export const ROSTER: Panelist[] = [
  { name: "Mike Rapin", display: "Mike Rapin", tagline: "Producer, Host, Pokémon Go Enthusiast", photo: "avatars/mike-rapin.webp" },
  { name: "Brian Murray", display: "Brian Murray", tagline: "Panelist, Star Wars Enabler, Night Owl", photo: "avatars/brian-murray.webp" },
  { name: "Daniel Martinez", display: "Daniel Martinez", tagline: "Panelist, YouTube Manager, Wannabe Artist, New Saiyan On The Block", aliases: ["Danny Martinez"], photo: "avatars/daniel-martinez.webp" },
  { name: "Kait Lamphere", display: "Kait Lamphere", tagline: "Panelist, Instagram and Goodreads Manager, Tea Drinker, Book Collector", photo: "avatars/kait-lamphere.webp" },
  { name: "Kara Szamborski", display: "Kara Szamborski", tagline: "Alternate Host, Panelist, Archie Ex, Unabashed Shipper", photo: "avatars/kara-szamborski.webp" },
  { name: "Kate Skocelas", display: "Kate Skocelas", tagline: "Panelist, Cat Mom, Skynet Researcher, Spooky Season Advocate", photo: "avatars/kate-skocelas.webp" },
  { name: "Nick White", display: "Nick White", tagline: "Panelist, West Michigan Weather Watcher, Aliens Aficionado, Snacks Boy", photo: "avatars/nick-white.webp" },
  { name: "Paloma Deerfield", display: "Paloma", tagline: "Panelist, Bat Queer, Manga Maven, Shop Gal", photo: "avatars/paloma-deerfield.webp" },
  { name: "Paul Jaissle", display: "Paul Jaissle", tagline: "Alternate Host, Panelist, Vegan Recipe Whiz, Love and Rockets Reader", photo: "avatars/paul-jaissle.webp" },
  { name: "René Rodriguez", display: "René Rodriguez", tagline: "Panelist, Spider-Guide, Manga Expert", photo: "avatars/rene-rodriguez.webp" },
  { name: "Tia Vasiliou", display: "Tia Vasiliou", tagline: "Panelist, Art Historian, Horse Girl, Fashion™", photo: "avatars/tia-vasiliou.webp" },
  { name: "Zach McCrary", display: "Zach McCrary", tagline: "Panelist, RPG Guy, Wrestling Opinions", photo: "avatars/zach-mccrary.webp" },
  { name: "Zander", display: "Zander Riggs", tagline: "Editor, Wizard, Our Favorite Person", photo: "avatars/zander.webp" },
];

export const ROSTER_MAP = new Map(ROSTER.map(p => [p.name, p]));

/** Every name that should match a panelist — canonical plus aliases. */
export function panelistNames(name: string): string[] {
  const p = ROSTER_MAP.get(name);
  return p?.aliases ? [name, ...p.aliases] : [name];
}

export function isRoster(name: string): boolean {
  return ROSTER_MAP.has(name);
}
