import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildArticleTaxonomy, resolveMagazineRoute } from "./note-magazine-registry.js";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

export function extractNoteKeyFromPublicUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" || parsed.hostname !== "note.com") return null;
    return /^\/[^/]+\/n\/(n[A-Za-z0-9_-]+)\/?$/u.exec(parsed.pathname)?.[1] || null;
  } catch {
    return null;
  }
}

export function magazineMembershipReceiptPath(series, episode) {
  if (!series?.seriesDir || !episode?.id) fail("MAGAZINE_MEMBERSHIP_PATH_IDENTITY_REQUIRED", "seriesDir and episode id are required");
  return join(series.seriesDir, "magazine-memberships", `${episode.id}.json`);
}

export function readMagazineMembershipReceipt(series, episode) {
  const path = magazineMembershipReceiptPath(series, episode);
  if (!existsSync(path)) return null;
  try {
    return Object.freeze(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    fail("MAGAZINE_MEMBERSHIP_RECEIPT_INVALID", `Magazine membership receipt is invalid: ${error.message}`, { path });
  }
}

export function derivePublishedArticleIdentity(series, episode, publicationReceipt = null) {
  if (!publicationReceipt) return null;
  if (publicationReceipt.seriesId !== series?.seriesId || publicationReceipt.episodeId !== episode?.id) {
    fail("MAGAZINE_PUBLICATION_RECEIPT_IDENTITY_MISMATCH", "Publication receipt does not match the requested series episode", {
      expectedSeriesId: series?.seriesId || null,
      expectedEpisodeId: episode?.id || null,
      actualSeriesId: publicationReceipt.seriesId || null,
      actualEpisodeId: publicationReceipt.episodeId || null,
    });
  }
  const publicUrl = String(publicationReceipt.publicUrl || "").trim();
  const noteKeyFromUrl = extractNoteKeyFromPublicUrl(publicUrl);
  const receiptNoteKey = String(publicationReceipt.noteKey || "").trim() || null;
  const recoveryNoteKey = String(publicationReceipt.recovery?.knownNoteKey || "").trim() || null;
  const candidates = [noteKeyFromUrl, receiptNoteKey, recoveryNoteKey].filter(Boolean);
  if (!candidates.length || new Set(candidates).size !== 1) {
    fail("MAGAZINE_NOTE_IDENTITY_NOT_EXACT", "Published article identity must resolve to one exact note key", {
      publicUrl: publicUrl || null,
      noteKeyFromUrl,
      receiptNoteKey,
      recoveryNoteKey,
    });
  }
  const noteKey = candidates[0];
  const knownEpisodeKey = String(episode?.publicationIdentity?.knownNoteKey || "").trim() || null;
  if (knownEpisodeKey && knownEpisodeKey !== noteKey) {
    fail("MAGAZINE_KNOWN_NOTE_KEY_MISMATCH", "Episode publicationIdentity conflicts with publication receipt note key", {
      knownEpisodeKey,
      receiptNoteKey: noteKey,
    });
  }
  return Object.freeze({
    seriesId: series.seriesId,
    episodeId: episode.id,
    sourceIdentifier: `${series.seriesId}/${episode.id}:${episode.sourcePath}`,
    noteKey,
    canonicalUrl: publicUrl,
    title: publicationReceipt.title || episode.title,
    revision: Object.freeze({
      knownNoteKey: knownEpisodeKey,
      recoveryKnownNoteKey: recoveryNoteKey,
    }),
  });
}

function findPublicationReceipt(series, episode, publicationReceipts = []) {
  const matches = publicationReceipts.filter((receipt) => receipt?.seriesId === series?.seriesId && receipt?.episodeId === episode?.id);
  if (matches.length > 1) fail("MAGAZINE_PUBLICATION_RECEIPT_DUPLICATE", `Multiple publication receipts found for ${series.seriesId}/${episode.id}`);
  return matches[0] || null;
}

function reviewPlan(base, action, reason) {
  return Object.freeze({ ...base, action, reason, articleCreation: "NO", mutationAllowed: false });
}

export function planMagazineMembership({
  series,
  episode,
  registry,
  publicationReceipts = [],
  membershipReceipt = null,
} = {}) {
  if (!series?.seriesId || !episode?.id) fail("MAGAZINE_PLAN_IDENTITY_REQUIRED", "Series and episode are required");
  if (!registry) fail("MAGAZINE_PLAN_REGISTRY_REQUIRED", "Magazine registry is required");

  const category = episode?.taxonomy?.category || series?.taxonomy?.category || null;
  const route = resolveMagazineRoute(registry, { seriesId: series.seriesId, category });
  const taxonomy = buildArticleTaxonomy(series, episode, route);
  const publicationReceipt = findPublicationReceipt(series, episode, publicationReceipts);
  let identity = null;
  if (publicationReceipt) identity = derivePublishedArticleIdentity(series, episode, publicationReceipt);

  const base = {
    seriesId: series.seriesId,
    episodeId: episode.id,
    title: episode.title,
    taxonomy,
    route,
    magazine: route.magazine,
    identity,
  };

  if (route.status !== "RESOLVED" || !route.magazine) {
    return reviewPlan(base, "REVIEW_ROUTING", route.reason || "unresolved-route");
  }

  if (publicationReceipt == null && episode?.publicationRecovery?.allowRepublishWhileUnresolved === false) {
    return reviewPlan(base, "REVIEW_PUBLICATION_IDENTITY_REQUIRED", "known-published-identity-unresolved");
  }

  if (!route.magazine.noteMagazineId) {
    const creation = publicationReceipt ? "NO" : "BY_EXISTING_PUBLICATION_PIPELINE";
    return Object.freeze({
      ...base,
      action: "REVIEW_MAGAZINE_ID_REQUIRED",
      reason: "noteMagazineId-missing",
      articleCreation: creation,
      mutationAllowed: false,
    });
  }

  if (publicationReceipt == null) {
    return Object.freeze({
      ...base,
      action: "PUBLISH_THEN_ADD_TO_MAGAZINE",
      reason: null,
      articleCreation: "BY_EXISTING_PUBLICATION_PIPELINE",
      mutationAllowed: false,
    });
  }

  if (membershipReceipt) {
    const failed = [];
    if (membershipReceipt.seriesId !== series.seriesId) failed.push("seriesId");
    if (membershipReceipt.episodeId !== episode.id) failed.push("episodeId");
    if (membershipReceipt.noteKey !== identity.noteKey) failed.push("noteKey");
    if (membershipReceipt.magazineKey !== route.magazine.magazineKey) failed.push("magazineKey");
    if (membershipReceipt.noteMagazineId !== route.magazine.noteMagazineId) failed.push("noteMagazineId");
    if (membershipReceipt.status !== "CONFIRMED") failed.push("status");
    if (failed.length) {
      return reviewPlan(base, "REVIEW_MEMBERSHIP_RECEIPT_CONFLICT", `membership-receipt-${failed.join("-")}`);
    }
    return Object.freeze({
      ...base,
      action: "NOOP_ALREADY_IN_MAGAZINE",
      reason: null,
      articleCreation: "NO",
      mutationAllowed: false,
    });
  }

  return Object.freeze({
    ...base,
    action: "ADD_TO_EXISTING_MAGAZINE",
    reason: null,
    articleCreation: "NO",
    mutationAllowed: true,
  });
}

export function formatMagazinePlan(plan) {
  const magazineName = plan.magazine?.displayName || "(unresolved)";
  const magazineId = plan.magazine?.noteMagazineId || "(not registered)";
  return [
    `Article: ${plan.title}`,
    `Series: ${plan.seriesId}`,
    `Category: ${plan.taxonomy?.category || "(none)"}`,
    `Publication Type: ${plan.taxonomy?.publicationType || "series-article"}`,
    `Order: ${plan.taxonomy?.order ?? "(none)"}`,
    `Resolved Magazine: ${magazineName}`,
    `Magazine ID: ${magazineId}`,
    `Route: ${plan.route?.basis || "none"}`,
    `Action: ${plan.action}`,
    `Article Creation: ${plan.articleCreation}`,
    `Note Key: ${plan.identity?.noteKey || "(not published / unresolved)"}`,
  ].join("\n");
}

export function writeMagazineMembershipReceipt(series, episode, plan, result, { now = new Date() } = {}) {
  if (plan?.action !== "ADD_TO_EXISTING_MAGAZINE" || !plan?.identity?.noteKey || !plan?.magazine?.noteMagazineId) {
    fail("MAGAZINE_MEMBERSHIP_WRITE_NOT_AUTHORIZED", "A resolved existing-article magazine plan is required before recording membership");
  }
  if (
    result?.status !== "PASS" ||
    result?.membershipConfirmed !== true ||
    result?.articleCreated === true ||
    result?.noteKey !== plan.identity.noteKey ||
    result?.noteMagazineId !== plan.magazine.noteMagazineId
  ) {
    fail("MAGAZINE_MEMBERSHIP_VERIFICATION_FAILED", "Magazine membership was not proven for the exact existing note identity", {
      expectedNoteKey: plan.identity.noteKey,
      expectedMagazineId: plan.magazine.noteMagazineId,
      result,
    });
  }
  const path = magazineMembershipReceiptPath(series, episode);
  if (existsSync(path)) fail("MAGAZINE_MEMBERSHIP_RECEIPT_ALREADY_EXISTS", `Magazine membership receipt already exists: ${path}`, { path });
  const receipt = {
    schemaVersion: 1,
    status: "CONFIRMED",
    seriesId: series.seriesId,
    episodeId: episode.id,
    sourceIdentifier: plan.identity.sourceIdentifier,
    noteKey: plan.identity.noteKey,
    canonicalUrl: plan.identity.canonicalUrl,
    magazineKey: plan.magazine.magazineKey,
    noteMagazineId: plan.magazine.noteMagazineId,
    confirmedAt: now.toISOString(),
    verification: result.verification || "exact-existing-note-membership",
  };
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  renameSync(temp, path);
  return Object.freeze({ path, receipt: Object.freeze(receipt) });
}

export async function executeMagazineMembership({ series, episode, plan, addToMagazine, now = new Date() } = {}) {
  if (plan?.action !== "ADD_TO_EXISTING_MAGAZINE") return Object.freeze({ status: "NO_MUTATION", plan });
  if (typeof addToMagazine !== "function") {
    return Object.freeze({ status: "REVIEW_LIVE_ADAPTER_REQUIRED", plan });
  }
  const result = await addToMagazine(Object.freeze({
    noteKey: plan.identity.noteKey,
    canonicalUrl: plan.identity.canonicalUrl,
    noteMagazineId: plan.magazine.noteMagazineId,
    noteMagazineUrl: plan.magazine.noteMagazineUrl,
    magazineKey: plan.magazine.magazineKey,
    magazineDisplayName: plan.magazine.displayName,
    articleCreationAllowed: false,
  }));
  const recorded = writeMagazineMembershipReceipt(series, episode, plan, result, { now });
  return Object.freeze({ status: "PASS", plan, ...recorded });
}
