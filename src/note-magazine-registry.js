import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MAGAZINE_REGISTRY_PATH = resolve(__dirname, "..", "config", "note-magazines.json");

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeStringArray(value, field, magazineKey) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail("MAGAZINE_REGISTRY_INVALID", `${field} must be an array`, { magazineKey, field });
  const result = value.map((item) => cleanString(item));
  if (result.some((item) => !item)) fail("MAGAZINE_REGISTRY_INVALID", `${field} contains an empty value`, { magazineKey, field });
  if (new Set(result).size !== result.length) fail("MAGAZINE_REGISTRY_INVALID", `${field} contains duplicate values`, { magazineKey, field });
  return result;
}

function normalizeMagazine(entry) {
  const magazineKey = cleanString(entry?.magazineKey);
  if (!magazineKey || !/^[a-z0-9-]+$/u.test(magazineKey)) {
    fail("MAGAZINE_KEY_INVALID", "magazineKey must contain only lowercase letters, numbers, and hyphens", { magazineKey });
  }
  const displayName = cleanString(entry?.displayName);
  if (!displayName) fail("MAGAZINE_DISPLAY_NAME_REQUIRED", `displayName is required for ${magazineKey}`);
  const order = Number(entry?.order);
  if (!Number.isSafeInteger(order) || order < 0) fail("MAGAZINE_ORDER_INVALID", `order must be a non-negative integer for ${magazineKey}`);
  const noteMagazineId = cleanString(entry?.noteMagazineId);
  const noteMagazineUrl = cleanString(entry?.noteMagazineUrl);
  if (noteMagazineUrl) {
    let parsed;
    try { parsed = new URL(noteMagazineUrl); } catch {
      fail("MAGAZINE_URL_INVALID", `noteMagazineUrl is invalid for ${magazineKey}`, { noteMagazineUrl });
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "note.com") {
      fail("MAGAZINE_URL_INVALID", `noteMagazineUrl must be an https://note.com URL for ${magazineKey}`, { noteMagazineUrl });
    }
  }
  if (entry?.indexVisible != null && typeof entry.indexVisible !== "boolean") {
    fail("MAGAZINE_INDEX_VISIBILITY_INVALID", `indexVisible must be boolean for ${magazineKey}`, { magazineKey, indexVisible: entry.indexVisible });
  }
  return Object.freeze({
    magazineKey,
    icon: cleanString(entry?.icon) || "",
    displayName,
    description: cleanString(entry?.description) || "",
    noteMagazineId,
    noteMagazineUrl,
    series: Object.freeze(normalizeStringArray(entry?.series, "series", magazineKey)),
    categories: Object.freeze(normalizeStringArray(entry?.categories, "categories", magazineKey)),
    active: entry?.active === true,
    indexVisible: entry?.indexVisible !== false,
    order,
  });
}

export function validateMagazineRegistry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("MAGAZINE_REGISTRY_INVALID", "Magazine registry must be an object");
  if (raw.schemaVersion !== 1) fail("MAGAZINE_REGISTRY_SCHEMA_UNSUPPORTED", `Unsupported magazine registry schemaVersion: ${raw.schemaVersion}`);
  if (!Array.isArray(raw.magazines)) fail("MAGAZINE_REGISTRY_INVALID", "magazines must be an array");

  const magazines = raw.magazines.map(normalizeMagazine);
  const keys = new Set();
  for (const magazine of magazines) {
    if (keys.has(magazine.magazineKey)) fail("MAGAZINE_KEY_DUPLICATE", `Duplicate magazineKey: ${magazine.magazineKey}`);
    keys.add(magazine.magazineKey);
  }

  const defaultMagazineKey = cleanString(raw.routing?.defaultMagazineKey);
  if (defaultMagazineKey && !keys.has(defaultMagazineKey)) {
    fail("MAGAZINE_DEFAULT_UNKNOWN", `routing.defaultMagazineKey references an unknown magazine: ${defaultMagazineKey}`);
  }

  const seriesIndex = raw.seriesIndex && typeof raw.seriesIndex === "object"
    ? Object.freeze({
        title: cleanString(raw.seriesIndex.title) || "連載・シリーズ一覧",
        noteKey: cleanString(raw.seriesIndex.noteKey),
        publicUrl: cleanString(raw.seriesIndex.publicUrl),
        updateMode: cleanString(raw.seriesIndex.updateMode) || "existing-only",
      })
    : Object.freeze({ title: "連載・シリーズ一覧", noteKey: null, publicUrl: null, updateMode: "existing-only" });

  return Object.freeze({
    schemaVersion: 1,
    routing: Object.freeze({
      defaultMagazineKey,
      ambiguityPolicy: cleanString(raw.routing?.ambiguityPolicy) || "review",
      missingIdPolicy: cleanString(raw.routing?.missingIdPolicy) || "skip-membership-review",
      membershipMode: cleanString(raw.routing?.membershipMode) || "single-target-v1",
    }),
    seriesIndex,
    magazines: Object.freeze(magazines),
  });
}

export function loadMagazineRegistry({ path = DEFAULT_MAGAZINE_REGISTRY_PATH } = {}) {
  if (!existsSync(path)) fail("MAGAZINE_REGISTRY_NOT_FOUND", `Magazine registry not found: ${path}`, { path });
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (error) {
    fail("MAGAZINE_REGISTRY_JSON_INVALID", `Magazine registry JSON is invalid: ${error.message}`, { path });
  }
  return validateMagazineRegistry(raw);
}

function resolution(status, basis, matches = [], magazine = null, reason = null) {
  return Object.freeze({ status, basis, matches: Object.freeze(matches.map((item) => item.magazineKey)), magazine, reason });
}

function resolveSingleMatch(matches, basis) {
  if (matches.length > 1) return resolution("REVIEW", basis, matches, null, `ambiguous-${basis}`);
  if (matches.length === 0) return null;
  const magazine = matches[0];
  if (!magazine.active) return resolution("REVIEW", basis, matches, null, `inactive-${basis}-match`);
  return resolution("RESOLVED", basis, matches, magazine, null);
}

export function resolveMagazineRoute(registry, { seriesId = null, category = null } = {}) {
  const normalizedSeries = cleanString(seriesId);
  const normalizedCategory = cleanString(category);

  if (normalizedSeries) {
    const exactSeries = registry.magazines.filter((magazine) => magazine.series.includes(normalizedSeries));
    const resolved = resolveSingleMatch(exactSeries, "series");
    if (resolved) return resolved;
  }

  if (normalizedCategory) {
    const exactCategory = registry.magazines.filter((magazine) => magazine.categories.includes(normalizedCategory));
    const resolved = resolveSingleMatch(exactCategory, "category");
    if (resolved) return resolved;
  }

  const defaultKey = registry.routing.defaultMagazineKey;
  if (defaultKey) {
    const magazine = registry.magazines.find((item) => item.magazineKey === defaultKey) || null;
    if (!magazine) return resolution("REVIEW", "default", [], null, "default-missing");
    if (!magazine.active) return resolution("REVIEW", "default", [magazine], null, "inactive-default");
    return resolution("RESOLVED", "default", [magazine], magazine, null);
  }

  return resolution("REVIEW", "none", [], null, "no-route");
}

export function buildArticleTaxonomy(series, episode, route = null) {
  const category = cleanString(episode?.taxonomy?.category) || cleanString(series?.taxonomy?.category) || (route?.magazine?.categories?.length === 1 ? route.magazine.categories[0] : null);
  const publicationType = cleanString(episode?.taxonomy?.publicationType) || cleanString(series?.taxonomy?.publicationType) || "series-article";
  const configuredOrder = episode?.taxonomy?.order ?? episode?.order ?? null;
  const parsedId = Number.parseInt(String(episode?.id || ""), 10);
  const order = configuredOrder !== null && configuredOrder !== undefined && Number.isSafeInteger(Number(configuredOrder))
    ? Number(configuredOrder)
    : Number.isFinite(parsedId) ? parsedId : null;
  return Object.freeze({
    category,
    series: cleanString(series?.seriesId),
    magazine: route?.magazine?.magazineKey || null,
    publicationType,
    order,
  });
}
