import { resolveMagazineRoute } from "./note-magazine-registry.js";

const NAVIGATION_LABEL = "**この連載のナビゲーション**";

function publicReceiptMap(receipts = []) {
  return new Map(receipts.filter((receipt) => receipt?.episodeId && receipt?.publicUrl).map((receipt) => [receipt.episodeId, receipt]));
}

function link(label, url) {
  return url ? `[${label}](${url})` : null;
}

function safeRelatedArticles(items = [], currentUrl = null) {
  return (items || [])
    .filter((item) => item?.publicUrl && item.publicUrl !== currentUrl)
    .filter((item) => item.contentType === "how-to" || item.kind === "how-to")
    .slice(0, 2)
    .map((item) => Object.freeze({ title: String(item.title || "関連How-to").trim(), publicUrl: item.publicUrl }));
}

export function buildSeriesNavigation({
  series,
  episode,
  publicationReceipts = [],
  registry,
  seriesIndexUrl = null,
  relatedArticles = [],
} = {}) {
  if (!series?.seriesId || !episode?.id || !registry) return Object.freeze({ markdown: "", links: Object.freeze({}) });
  const index = series.episodes.findIndex((item) => item.id === episode.id);
  if (index < 0) return Object.freeze({ markdown: "", links: Object.freeze({}) });

  const receipts = publicReceiptMap(publicationReceipts);
  const first = series.episodes[0];
  const previous = index > 0 ? series.episodes[index - 1] : null;
  const next = index + 1 < series.episodes.length ? series.episodes[index + 1] : null;
  const current = receipts.get(episode.id) || null;
  const category = episode?.taxonomy?.category || series?.taxonomy?.category || null;
  const route = resolveMagazineRoute(registry, { seriesId: series.seriesId, category });
  const magazineUrl = route.status === "RESOLVED" ? route.magazine?.noteMagazineUrl || null : null;
  const resolvedSeriesIndexUrl = seriesIndexUrl || registry?.seriesIndex?.publicUrl || null;
  const related = safeRelatedArticles(relatedArticles, current?.publicUrl || null);

  const links = Object.freeze({
    previous: previous ? receipts.get(previous.id)?.publicUrl || null : null,
    next: next ? receipts.get(next.id)?.publicUrl || null : null,
    first: first ? receipts.get(first.id)?.publicUrl || null : null,
    magazine: magazineUrl,
    series: magazineUrl,
    seriesIndex: resolvedSeriesIndexUrl,
    related: Object.freeze(related),
  });

  const items = [
    link("← 前の記事", links.previous),
    link("第1回から読む", links.first),
    link("この連載のマガジン", links.magazine),
    link("この連載の一覧", links.seriesIndex),
    link("次の記事 →", links.next),
  ].filter(Boolean);
  for (const item of related) items.push(link(`関連：${item.title}`, item.publicUrl));

  if (!items.length) return Object.freeze({ markdown: "", links });
  const markdown = `\n---\n\n${NAVIGATION_LABEL}\n\n${items.join(" ｜ ")}\n`;
  return Object.freeze({ markdown, links });
}

export function appendSeriesNavigation(markdown, navigation) {
  const source = String(markdown ?? "").trimEnd();
  const nav = String(navigation?.markdown || "").trim();
  if (!nav) return `${source}\n`;
  if (source.includes(NAVIGATION_LABEL)) return `${source}\n`;
  return `${source}\n\n${nav}\n`;
}
