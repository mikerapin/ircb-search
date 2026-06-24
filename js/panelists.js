// @ts-check
// Canonical panelist roster and name-resolution helper.

/** @typedef {import("./types").Panelist} Panelist */

/** @type {Panelist[]} */
export const PANELISTS = [
    { name: "Mike Rapin",       display: "Mike Rapin",       tagline: "Producer, Host, Pokémon Go Enthusiast",                                    photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/fdeaa485-7fc3-465f-aaea-629a5711facf/mike.png" },
    { name: "Brian Murray",     display: "Brian Murray",     tagline: "Panelist, Star Wars Enabler, Night Owl",                                   photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/b31a53a8-b6b2-4756-a3f7-8126c423516b/brian_transparent.png" },
    { name: "Daniel Martinez",  display: "Daniel Martinez",  tagline: "Panelist, YouTube Manager, Wannabe Artist, New Saiyan On The Block",        aliases: ["Danny Martinez"], photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/4cd0101a-59fb-47d8-af40-2ecc960687a9/danny_icon_transparent_edit.png" },
    { name: "Kait Lamphere",    display: "Kait Lamphere",    tagline: "Panelist, Instagram and Goodreads Manager, Tea Drinker, Book Collector",    photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/bdf64a36-d529-48b3-908c-9ec19b6c96e2/kait_transparent.png" },
    { name: "Kara Szamborski",  display: "Kara Szamborski",  tagline: "Alternate Host, Panelist, Archie Ex, Unabashed Shipper",                   photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/0e212901-c372-4d83-a807-d2c958faa740/kara_reivison3_transparent.png" },
    { name: "Kate Skocelas",    display: "Kate Skocelas",    tagline: "Panelist, Cat Mom, Skynet Researcher, Spooky Season Advocate",              photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/6b6e747b-6467-4f78-96ea-2450f310c5d1/kate_transparent.png" },
    { name: "Nick White",       display: "Nick White",       tagline: "Panelist, West Michigan Weather Watcher, Aliens Aficionado, Snacks Boy",    photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/a133116d-3010-4d6b-8fbb-7df32bf729f2/nick_transparent.png" },
    { name: "Paloma Deerfield", display: "Paloma",           tagline: "Panelist, Bat Queer, Manga Maven, Shop Gal",                               photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/438cef1d-8fb3-425a-9ddc-4366b4e88357/paloma_transparent.png" },
    { name: "Paul Jaissle",     display: "Paul Jaissle",     tagline: "Alternate Host, Panelist, Vegan Recipe Whiz, Love and Rockets Reader",      photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/2eb2279f-e64e-42c1-939f-824b11d51b07/paul_transparent.png" },
    { name: "René Rodriguez",   display: "René Rodriguez",   tagline: "Panelist, Spider-Guide, Manga Expert",                                      photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/f48e440a-1e29-428c-b231-7e133ef77bf7/rene_transparent.png" },
    { name: "Tia Vasiliou",     display: "Tia Vasiliou",     tagline: "Panelist, Art Historian, Horse Girl, Fashion™",                             photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/8960ab9d-cb48-4460-b0a7-588054e1fca2/tia_revision_transparent.png" },
    { name: "Zach McCrary",     display: "Zach McCrary",     tagline: "Panelist, RPG Guy, Wrestling Opinions",                                     photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/0f26d109-b34c-433d-b38b-69f8eae9df74/zach_transparent.png" },
    { name: "Zander",           display: "Zander Riggs",     tagline: "Editor, Wizard, Our Favorite Person",                                       photo: "https://images.squarespace-cdn.com/content/v1/64bab1448cbc203e853efeed/33a0d63b-8fa2-48b8-851c-b34766369026/zander_revision_transparent.png" },
];

/** @type {Record<string, Panelist>} */
export const PANELIST_MAP = Object.fromEntries(PANELISTS.map(p => [p.name, p]));

/**
 * All names (canonical + aliases) that should match a given panelist.
 * @param {string} name
 * @returns {string[]}
 */
export function panelistNames(name) {
    const p = PANELIST_MAP[name];
    return p && p.aliases ? [name, ...p.aliases] : [name];
}
