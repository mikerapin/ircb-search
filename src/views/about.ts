import { core, mentions as loadMentions } from "../data/load";
import { ALIASED_REGULARS, ROSTER } from "../data/roster";
import { TAGGED } from "../data/shape";
import type { EpisodeCore } from "../data/types";
import { nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { subscribeCoupon } from "./blocks";

/**
 * The three eras, as counts.
 *
 * They must partition the archive, so they split on one axis: in the feed or not, then
 * Patreon or not. Splitting the back catalogue on `date` instead looked verified — the
 * counts summed to 798 — while double-counting the one dated Patreon record (Wic+Div's
 * Younger Sibling) and orphaning the one record with no showId, no date and no Patreon URL.
 *
 * Exported so the invariant is reachable, because **on the live data the broken split and
 * the correct one return the identical 84**: the double-count and the orphan cancel in the
 * count exactly as they cancel in the sum, so no assertion about a rendered number can tell
 * them apart. Only a fixture built to separate them can. See tests/unit/eras.test.ts.
 */
export function eraCounts(episodes: EpisodeCore[]): {
  feed: number; backCatalogue: number; backCatalogueDated: number; patreonShelf: number;
} {
  return {
    feed: episodes.filter(e => e.showId).length,
    backCatalogue: episodes.filter(e => !e.showId && !e.patreonUrl).length,
    backCatalogueDated: episodes.filter(e => !e.showId && !e.patreonUrl && e.date).length,
    patreonShelf: episodes.filter(e => !e.showId && e.patreonUrl).length,
  };
}

/**
 * Every figure here is computed from the same files the rest of the site reads, so the page
 * cannot drift from the data it describes. Nothing is written down as a literal.
 */
/* Sections a link elsewhere can point at. The hash is the router, so an in-page anchor has
   nowhere to live — the target is a query parameter and the view scrolls to it after paint,
   which is also after setView's own scrollTo(0,0). */
const SECTIONS: Record<string, string> = { names: "why-the-names" };

export async function viewAbout(qs?: URLSearchParams): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const men = await loadMentions();
  const s = data.stats;

  const byKey = new Map(data.episodes.map(e => [e.key, e]));
  const noMention = s.episodes - s.indexedEpisodes;
  const undated = data.episodes.filter(e => !e.date).length;
  const noAudio = data.episodes.filter(e => !e.enclosure).length;
  const { feed: feedEps, backCatalogue, backCatalogueDated, patreonShelf } = eraCounts(data.episodes);
  const noTitle = data.episodes.filter(e => !e.title).length;
  const noMinute = men.filter(m => m.secs == null).length;
  const tagged = men.filter(m => m.segment === TAGGED).length;
  /* Not `men.length - noMinute`: a minute is necessary but not sufficient. jumpable() also
     needs audio on file and a stamp inside the runtime, which is one mention fewer. Quote
     the number the play controls actually honour. */
  const canJump = men.filter(m => jumpable(m, byKey.get(m.epKey))).length;
  const pastRuntime = men.filter(m => {
    const e = byKey.get(m.epKey);
    return m.secs != null && e?.runtimeSecs != null && m.secs >= e.runtimeSecs;
  }).length;
  const folded = s.uniqueComics - s.series;

  const html =
    `<div class="pagehead"><div class="eyebrow">Catalogue policy</div><h1 class="disp">About the Data</h1>
      <p>What we logged, where it came from, and what we know is missing. Every number on this
      page is counted live from the same files the rest of the site reads.</p></div>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">Where All This Came From</h2></div>
      <dl class="kv">
        <div><dt>Comics</dt><dd>Most comics here were logged by hand from our show notes, and
          <a href="https://github.com/sshugars/ircb">sshugars/ircb</a> keeps that data in the open.
          We build the whole site off it: ${nf(s.mentions)} comics across ${nf(s.indexedEpisodes)} episodes.
          ${nf(men.length - noMinute)} of them have a minute attached, which is what lets you jump straight to
          where we started talking.</dd></div>
        <div><dt>Tags</dt><dd>${nf(tagged)} more came from the keywords we file each episode under,
          for books the notes never listed. They only ever join a run already on the shelf &mdash; a tag
          can add an episode to one, never start one &mdash; and they carry no minute, because a tag records
          that a book came up and nothing about when. They&rsquo;re marked <b>Tagged</b> in a checklist.</dd></div>
        <div><dt>Episodes</dt><dd>The same repo has our episode table, with titles, air dates and who was on the
          panel for all ${nf(s.episodes)} records. Our <a href="https://feeds.simplecast.com/U93zjuSN">Simplecast
          feed</a> fills in artwork, runtimes and audio for the ${nf(feedEps)} episodes that made it there.</dd></div>
        <div><dt>Audio</dt><dd>When you hit play you&rsquo;re hearing our actual feed. Nothing is re-hosted, so
          listening here counts the same as listening anywhere else.</dd></div>
        <div><dt>Faces</dt><dd>IRCB&rsquo;s roster is ${ROSTER.length} regulars. Guests don&rsquo;t get a portrait,
          so their pages run on the record alone.</dd></div>
        <div><dt>Covers</dt><dd>Every comic wears a generated cover for now. Real cover art is on our list, and
          when we get there it&rsquo;ll come from GCD and Metron with credit. Those images belong to their
          publishers, and we&rsquo;d only use them to show you which book we meant.</dd></div>
      </dl>
    </section>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">The Show Is Older Than The Feed</h2></div>
      <p class="lead">Our archive comes in three piles.</p>
      <dl class="kv">
        <div><dt>In the feed</dt><dd>${nf(feedEps)} episodes are in the public RSS feed. These are the ones with
          a number, artwork, a runtime and audio, and our comic index reaches
          ${nf(s.indexedEpisodes)} of them.</dd></div>
        <div><dt>Before the feed</dt><dd>${nf(backCatalogue)} came before it. ${nf(backCatalogueDated)} of those
          have an air date. What&rsquo;s missing is the audio, so those pages don&rsquo;t offer a play button, and
          they never got a number.</dd></div>
        <div><dt>The Patreon shelf</dt><dd>${nf(patreonShelf)} are bonus episodes we made for Patreon members.
          They never hit the public feed and most have no recoverable air date, so they link to Patreon instead
          of audio. All told, ${nf(noAudio)} records have no audio on file.</dd></div>
      </dl>
    </section>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">What&rsquo;s Missing</h2>
        <span class="note">We&rsquo;d rather tell you</span></div>
      <dl class="kv">
        <div><dt>Minutes</dt><dd><b>${nf(noMinute)} of our ${nf(men.length)} logged comics have no timestamp.</b>
          Mostly somebody caught the book but not the minute; ${nf(tagged)} came from an episode&rsquo;s tags,
          which never had a minute to catch. Those show <b>&mdash;:&mdash;&mdash;</b> and link to the
          episode rather than fake a play button. ${nf(canJump)} can actually be jumped into.</dd></div>
        <div><dt>Dates</dt><dd>${nf(undated)} episodes have no recoverable air date, so they sort last and sit
          outside every calendar.</dd></div>
        <div><dt>Blank spots</dt><dd>${nf(noMention)} episodes have no comic data at all. That&rsquo;s why we say
          <b>${nf(s.indexedEpisodes)} episodes indexed</b> and not ${nf(s.episodes)} searchable.</dd></div>
        ${pastRuntime ? `<div><dt>Bad stamps</dt><dd>${nf(pastRuntime)} comic${pl(pastRuntime)} carries a timestamp
          past the end of its own episode, which is a typo in the notes. We don&rsquo;t offer those as
          jumps.</dd></div>` : ""}
        ${noTitle ? `<div><dt>No title</dt><dd>${nf(noTitle)} record${pl(noTitle)} has no title at all. It still
          gets a page, because it still happened.</dd></div>` : ""}
        <div><dt>Names</dt><dd>${nf(ALIASED_REGULARS)} of our regulars turn up under a short name in some episodes,
          usually a first name. Every spelling resolves to one person so nobody&rsquo;s episode count gets split in
          half. Guests are whoever showed up in the credits and isn&rsquo;t on the roster.</dd></div>
      </dl>
    </section>` +

    `<section class="sec" id="why-the-names">
      <div class="sec-head"><h2 class="disp">Why The Comic Names Look Like That</h2>
        <span class="note">${nf(s.uniqueComics)} written names &rarr; ${nf(s.series)} series</span></div>
      <p class="lead">We wrote a comic down however it came up on the show, so the same run shows up as
      <i>Saga</i>, <i>Saga #12</i> and <i>Saga Vol. 3</i>. To get one page per run, ${nf(folded)} of those
      ${nf(s.uniqueComics)} names fold into another.</p>
      <dl class="kv">
        <div><dt>We strip</dt><dd>Issue, volume and chapter numbers: <b>#12</b>, <b>Vol. 3</b>, <b>Book 1</b>,
          <b>Chapter 381</b>. Also <b>ft.</b> credits, and the stray HTML that rode in with some scraped show
          notes.</dd></div>
        <div><dt>We fold</dt><dd>Spellings that differ only in punctuation or capitals. <i>Star Wars: Visions</i>
          and <i>Star Wars Visions</i> land on one page, and so do <i>Dead Dog&rsquo;s Bite</i> and
          <i>Dead Dogs Bite</i>. Each run shows up under whichever spelling we wrote most often.</dd></div>
        <div><dt>We don&rsquo;t fold</dt><dd>Anything that differs by a letter or a word. Merging <i>Monster</i>
          with <i>Monsters</i> would quietly lie about which episode discussed which book, so those near-misses
          get a <b>See Also</b> instead.</dd></div>
        <div><dt>Volume years</dt><dd>A year in brackets usually gets dropped. We keep it when the same title
          turns up under two of them, which is how <i>Mister Miracle (1971)</i> and <i>Mister Miracle (2017)</i>
          end up on separate pages.</dd></div>
      </dl>
    </section>` +

    `<section class="sec">
      <div class="sparse">
        That&rsquo;s all ${nf(s.episodes)} of our episode records, every one of the ${nf(s.mentions)} comics we
        logged, ${nf(s.series)} series and the ${nf(s.people)} people who have sat at the table.
        <a href="${href("/index")}">Go browse the whole index &rarr;</a>
      </div>
    </section>` +

    subscribeCoupon();

  const target = SECTIONS[qs?.get("to") ?? ""];
  return {
    html,
    after: () => {
      if (!target) return;
      /* rAF, not the same tick: the view has been assigned but not laid out, so an immediate
         scroll measures the old page's geometry. scrollIntoView honours the reduced-motion
         override on html{scroll-behavior}. */
      requestAnimationFrame(() =>
        document.getElementById(target)?.scrollIntoView({ block: "start" }));
    },
  };
}
