import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SERIES_INDEX_OUTPUT = resolve(__dirname, "..", "output", "magazines", "series-index.md");

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function label(magazine) {
  return [magazine.icon, magazine.displayName].filter(Boolean).join(" ");
}

export function orderedActiveMagazines(registry) {
  return [...registry.magazines]
    .filter((magazine) => magazine.active && magazine.indexVisible !== false)
    .sort((a, b) => a.order - b.order || a.magazineKey.localeCompare(b.magazineKey));
}

export function renderSeriesIndexMarkdown(registry) {
  const title = registry.seriesIndex?.title || "連載・シリーズ一覧";
  const lines = [
    `# ${title}`,
    "",
    "公開中の連載やツールを、テーマ別のnoteマガジンから探せます。",
    "",
  ];
  for (const magazine of orderedActiveMagazines(registry)) {
    lines.push(`## ${label(magazine)}`, "");
    if (magazine.description) lines.push(magazine.description, "");
    if (magazine.noteMagazineUrl) lines.push(`[→ マガジンを見る](${magazine.noteMagazineUrl})`, "");
    else lines.push("→ マガジンURL登録待ち", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function planSeriesIndexUpdate(registry) {
  const markdown = renderSeriesIndexMarkdown(registry);
  const missingMagazineKeys = orderedActiveMagazines(registry)
    .filter((magazine) => !magazine.noteMagazineUrl)
    .map((magazine) => magazine.magazineKey);
  const base = {
    articleCreation: "NO",
    noteKey: registry.seriesIndex?.noteKey || null,
    publicUrl: registry.seriesIndex?.publicUrl || null,
    missingMagazineKeys: Object.freeze(missingMagazineKeys),
    markdown,
  };
  if (!registry.seriesIndex?.noteKey) {
    return Object.freeze({ ...base, action: "REVIEW_INDEX_NOTE_ID_REQUIRED" });
  }
  if (missingMagazineKeys.length) {
    return Object.freeze({ ...base, action: "REVIEW_INDEX_MAGAZINE_URLS_REQUIRED" });
  }
  return Object.freeze({ ...base, action: "UPDATE_EXISTING_INDEX_ARTICLE" });
}

export function writeSeriesIndexMarkdown(registry, { path = DEFAULT_SERIES_INDEX_OUTPUT } = {}) {
  const markdown = renderSeriesIndexMarkdown(registry);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, markdown, "utf8");
  return Object.freeze({ path, markdown });
}

export async function executeSeriesIndexUpdate({ registry, plan = planSeriesIndexUpdate(registry), updateExistingArticle } = {}) {
  if (plan.action !== "UPDATE_EXISTING_INDEX_ARTICLE") {
    return Object.freeze({ status: "NO_MUTATION", plan });
  }
  if (typeof updateExistingArticle !== "function") {
    return Object.freeze({ status: "REVIEW_LIVE_ADAPTER_REQUIRED", plan });
  }
  const result = await updateExistingArticle(Object.freeze({
    noteKey: plan.noteKey,
    publicUrl: plan.publicUrl,
    title: registry.seriesIndex.title,
    markdown: plan.markdown,
    articleCreationAllowed: false,
  }));
  if (
    result?.status !== "PASS" ||
    result?.articleCreated === true ||
    result?.contentConfirmed !== true ||
    result?.noteKey !== plan.noteKey ||
    (plan.publicUrl && result?.publicUrl !== plan.publicUrl)
  ) {
    fail("SERIES_INDEX_UPDATE_VERIFICATION_FAILED", "Series index update was not proven on the exact existing note article", {
      expectedNoteKey: plan.noteKey,
      expectedPublicUrl: plan.publicUrl,
      result,
    });
  }
  return Object.freeze({ status: "PASS", plan, result: Object.freeze({ ...result }) });
}
