import { resolveMagazineRoute } from "./note-magazine-registry.js";

const NAVIGATION_LABEL = "**この連載のナビゲーション**";

function publicReceiptMap(receipts = []) {
  return new Map(receipts.filter((receipt) => receipt?.episodeId && receipt?.publicUrl).map((receipt) => [receipt.episodeId, receipt]));
}

function link(label, url) {
  return url ? `[${label}](${url})` : null;
}

export function buildSeriesNavigation({ series, episode, publicationReceipts = [], registry } = {}) {
  if (!series?.seriesId || !episode?.id || !registry) return Object.freeze({ markdown: "", links: Object.freeze({}) });
  const index = series.episodes.findIndex((item) => item.id === episode.id);
  if (index < 0) return Object.freeze({ markdown: "", links: Object.freeze({}) });

  const receipts = publicReceiptMap(publicationReceipts);
  const first = series.episodes[0];
  const previous = index > 0 ? series.episodes[index - 1] : null;
  const next = index + 1 < series.episodes.length ? series.episodes[index + 1] : null;
  const category = episode?.taxonomy?.category || series?.taxonomy?.category || null;
  const route = resolveMagazineRoute(registry, { seriesId: series.seriesId, category });
  const magazineUrl = route.status === "RESOLVED" ? route.magazine?.noteMagazineUrl || null : null;

  const links = Object.freeze({
    previous: previous ? receipts.get(previous.id)?.publicUrl || null : null,
    next: next ? receipts.get(next.id)?.publicUrl || null : null,
    first: first ? receipts.get(first.id)?.publicUrl || null : null,
    series: magazineUrl,
  });

  const items = [
    link("← 前の記事", links.previous),
    link("第1回から読む", links.first),
    link("この連載の一覧", links.series),
    link("次の記事 →", links.next),
  ].filter(Boolean);
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
