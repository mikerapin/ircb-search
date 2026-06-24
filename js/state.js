// @ts-check
// Single shared mutable app state. Modules import this object and mutate its
// fields (state.query = ...) so writes are visible across module boundaries
// without a bundler. Live ES-module bindings are read-only to importers, so a
// plain object — not exported `let`s — is what makes cross-module state work.

/** @typedef {import("./types").Comic} Comic */
/** @typedef {import("./types").Episode} Episode */

export const state = {
    /** @type {Comic[]} */                        comics: [],
    /** @type {Episode[]} */                      episodes: [],
    /** @type {Record<string, Episode>} */        epMap: {},
    /** @type {Record<string, Set<string>>} */    comicsByEp: {},
    /** @type {any} Fuse index over comics */     fuseComics: null,
    /** @type {any} Fuse index over episodes */   fuseEpisodes: null,
    /** @type {{name:string,count:number}[]} */   topComics: [],
    /** @type {{name:string,count:number}[]} */   topRecentComics: [],
    /** @type {string[]} active panelist names */ panelists: [],
    /** @type {string} "all" | "comics" | "topics" */ mode: "all",
    /** @type {string} "relevance" | "recent" */      sort: "relevance",
    query: "",
    /** @type {string|null} */                    panelist: null,
    guestOnly: false,
    /** @type {string|null} */                    openEmbed: null,
    /** @type {ReturnType<typeof setTimeout>|undefined} */ searchDebounceTimer: undefined,
    /** @type {string[]} */                       latestEpisodeComics: [],
    /** @type {Episode|null} */                   latestEpisodeInfo: null,
    /** @type {Episode[]} top 3 most recent */    recentEpisodes: [],
    /** @type {string|null} */                    panelistView: null,
    /** @type {"newest"|"oldest"} */              panelistSort: "newest",
};
