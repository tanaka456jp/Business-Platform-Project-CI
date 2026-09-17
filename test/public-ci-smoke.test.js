import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildArticleTaxonomy,
  resolveMagazineRoute,
  validateMagazineRegistry,
} from "../src/note-magazine-registry.js";
import {
  derivePublishedArticleIdentity,
  executeMagazineMembership,
  extractNoteKeyFromPublicUrl,
  planMagazineMembership,
} from "../src/note-magazine-routing.js";
import { buildSeriesNavigation } from "../src/series-navigation.js";
import {
  executeSeriesIndexUpdate,
  planSeriesIndexUpdate,
  renderSeriesIndexMarkdown,
} from "../src/note-series-index.js";

const registry = validateMagazineRegistry({
  schemaVersion: 1,
  routing: {
    defaultMagazineKey: null,
    ambiguityPolicy: "review",
    missingIdPolicy: "skip-membership-review",
    membershipMode: "single-target-v1",
  },
  seriesIndex: {
    title: "Series index",
    noteKey: "n-public-index",
    publicUrl: "https://note.com/example/n/n-public-index",
    updateMode: "existing-only",
  },
  magazines: [
    {
      magazineKey: "sample-series",
      displayName: "Sample Series",
      description: "Synthetic public-CI fixture",
      noteMagazineId: "m-public-sample",
      noteMagazineUrl: "https://note.com/example/m/m-public-sample",
      series: ["sample-series"],
      categories: ["sample-category"],
      active: true,
      indexVisible: true,
      order: 10,
    },
  ],
});

const tempSeriesDir = mkdtempSync(join(tmpdir(), "business-platform-public-ci-"));
const series = {
  seriesId: "sample-series",
  seriesDir: tempSeriesDir,
  taxonomy: { category: "sample-category", publicationType: "development-series" },
  episodes: [
    { id: "001", title: "Episode 1", sourcePath: "episodes/001.md" },
    { id: "002", title: "Episode 2", sourcePath: "episodes/002.md" },
  ],
};
const publicationReceipt = {
  schemaVersion: 1,
  seriesId: "sample-series",
  episodeId: "001",
  title: "Episode 1",
  publicUrl: "https://note.com/example/n/n-public-001",
};

try {
  const route = resolveMagazineRoute(registry, {
    seriesId: series.seriesId,
    category: series.taxonomy.category,
  });
  assert.equal(route.status, "RESOLVED");
  assert.equal(route.basis, "series");
  assert.equal(route.magazine.magazineKey, "sample-series");

  const taxonomy = buildArticleTaxonomy(series, series.episodes[0], route);
  assert.equal(taxonomy.category, "sample-category");
  assert.equal(taxonomy.series, "sample-series");
  assert.equal(taxonomy.magazine, "sample-series");
  assert.equal(taxonomy.order, 1);

  assert.equal(extractNoteKeyFromPublicUrl(publicationReceipt.publicUrl), "n-public-001");
  assert.equal(extractNoteKeyFromPublicUrl("https://example.com/not-note"), null);

  const identity = derivePublishedArticleIdentity(series, series.episodes[0], publicationReceipt);
  assert.equal(identity.noteKey, "n-public-001");
  assert.equal(identity.canonicalUrl, publicationReceipt.publicUrl);

  const plan = planMagazineMembership({
    series,
    episode: series.episodes[0],
    registry,
    publicationReceipts: [publicationReceipt],
  });
  assert.equal(plan.action, "ADD_TO_EXISTING_MAGAZINE");
  assert.equal(plan.articleCreation, "NO");
  assert.equal(plan.mutationAllowed, true);

  const noAdapter = await executeMagazineMembership({
    series,
    episode: series.episodes[0],
    plan,
  });
  assert.equal(noAdapter.status, "REVIEW_LIVE_ADAPTER_REQUIRED");

  const applied = await executeMagazineMembership({
    series,
    episode: series.episodes[0],
    plan,
    now: new Date("2026-09-17T00:00:00Z"),
    addToMagazine: async (request) => ({
      status: "PASS",
      membershipConfirmed: true,
      articleCreated: false,
      noteKey: request.noteKey,
      noteMagazineId: request.noteMagazineId,
      verification: "synthetic-public-ci",
    }),
  });
  assert.equal(applied.status, "PASS");

  const rerun = planMagazineMembership({
    series,
    episode: series.episodes[0],
    registry,
    publicationReceipts: [publicationReceipt],
    membershipReceipt: applied.receipt,
  });
  assert.equal(rerun.action, "NOOP_ALREADY_IN_MAGAZINE");

  const navigation = buildSeriesNavigation({
    series,
    episode: series.episodes[0],
    publicationReceipts: [publicationReceipt],
    registry,
  });
  assert.match(navigation.markdown, /第1回から読む/u);
  assert.match(navigation.markdown, /この連載の一覧/u);

  const markdown = renderSeriesIndexMarkdown(registry);
  assert.match(markdown, /Sample Series/u);
  assert.match(markdown, /m-public-sample/u);

  const indexPlan = planSeriesIndexUpdate(registry);
  assert.equal(indexPlan.action, "UPDATE_EXISTING_INDEX_ARTICLE");
  const indexNoAdapter = await executeSeriesIndexUpdate({ registry, plan: indexPlan });
  assert.equal(indexNoAdapter.status, "REVIEW_LIVE_ADAPTER_REQUIRED");

  const indexApplied = await executeSeriesIndexUpdate({
    registry,
    plan: indexPlan,
    updateExistingArticle: async (request) => ({
      status: "PASS",
      articleCreated: false,
      contentConfirmed: true,
      noteKey: request.noteKey,
      publicUrl: request.publicUrl,
    }),
  });
  assert.equal(indexApplied.status, "PASS");

  console.log("public CI smoke tests passed");
} finally {
  rmSync(tempSeriesDir, { recursive: true, force: true });
}
