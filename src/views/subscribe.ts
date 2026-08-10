import { core } from "../data/load";
import { nf } from "../lib/html";
import { patreonAd, subscribeCoupon } from "./blocks";

export async function viewSubscribe(): Promise<{ html: string; after: () => void }> {
  const data = await core();

  const html =
    `<div class="pagehead"><div class="eyebrow">Where to get it</div><h1 class="disp">Subscribe</h1>
      <p>${nf(data.stats.episodes)} episodes since 2015, still every Wednesday. We&rsquo;re free everywhere,
      and the bonus shelf lives on Patreon.</p></div>` +
    subscribeCoupon() +
    patreonAd(data);

  return { html, after: () => {} };
}
