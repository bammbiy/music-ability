// Album acclaim service: looks up cached scores, queues missing albums for
// background collection, and keeps a learned per-source calibration.

import { readFileSync } from "node:fs";
import { createSources } from "./sources.js";
import { albumKey, learnSourceCalibration, summarizeAlbum } from "./score.js";
import { getAlbumScores, getCommunityRatings, listAlbumRecords, saveAlbumScore } from "../store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = { ok: 30 * DAY_MS, partial: DAY_MS, not_found: 7 * DAY_MS, error: 60 * 60 * 1000 };
const MAX_QUEUE = 2000;
const CALIBRATION_TTL_MS = 30 * 60 * 1000;

export function createAcclaimService({ enabled = true, contact, discogsToken, lastfmKey, sampleFile } = {}) {
  const sources = createSources({ contact, discogsToken, lastfmKey });
  const sampleRecords = loadSamples(sampleFile);
  const queue = [];
  const queued = new Set();
  let running = false;
  let calibration = { value: {}, expiresAt: 0 };

  // excludeUserId: the viewer, whose own album ratings must not count toward
  // their own result.
  function lookup(albums, { sample = false, excludeUserId = "" } = {}) {
    const wanted = new Map();
    for (const item of albums) {
      const key = albumKey(item.artist, item.album);
      if (key && !wanted.has(key)) wanted.set(key, { key, artist: item.artist, album: item.album });
    }

    const summaries = new Map();
    let pending = 0;
    let notFound = 0;
    let failed = 0;

    if (sample) {
      for (const key of wanted.keys()) {
        const record = sampleRecords.get(key);
        if (record) summaries.set(key, summarizeAlbum(record, currentCalibration()));
        else notFound += 1;
      }
      return { summaries, pending, notFound, failed, total: wanted.size, enabled: true };
    }

    const cached = getAlbumScores([...wanted.keys()]);
    const community = getCommunityRatings([...wanted.keys()], excludeUserId);
    for (const [key, item] of wanted) {
      const hit = cached.get(key);
      const members = community.get(key) || null;
      if (hit?.status === "ok") {
        summaries.set(key, summarizeAlbum(hit.record, currentCalibration(), members));
        continue;
      }
      // No open data (yet, or at all), but Music Ability users rated it.
      if (members) {
        summaries.set(key, summarizeAlbum({ ...item, critics: [], sources: ["members"] }, currentCalibration(), members));
      }
      if (hit?.status === "error") {
        failed += 1;
      } else if (hit) {
        notFound += 1;
      } else if (enabled) {
        enqueue(item);
        pending += 1;
      }
    }

    return { summaries, pending, notFound, failed, total: wanted.size, enabled };
  }

  function enqueue(item) {
    if (queued.has(item.key) || queue.length >= MAX_QUEUE) return;
    queued.add(item.key);
    queue.push(item);
    if (!running) run();
  }

  async function run() {
    running = true;
    while (queue.length) {
      const item = queue.shift();
      try {
        const { status, partial, record, error } = await sources.collect(item);
        saveAlbumScore({ ...item, status, record, ttlMs: partial ? TTL_MS.partial : TTL_MS[status] });
        if (error) console.warn(`acclaim: ${item.artist} - ${item.album}: ${error}`);
      } catch (error) {
        console.error("acclaim: collection failed", error);
      } finally {
        queued.delete(item.key);
      }
    }
    running = false;
  }

  function currentCalibration() {
    if (calibration.expiresAt > Date.now()) return calibration.value;
    try {
      calibration = { value: learnSourceCalibration(listAlbumRecords()), expiresAt: Date.now() + CALIBRATION_TTL_MS };
    } catch (error) {
      console.error("acclaim: calibration failed", error);
      calibration = { value: {}, expiresAt: Date.now() + 60 * 1000 };
    }
    return calibration.value;
  }

  return {
    lookup,
    status: () => ({ enabled, queued: queue.length, running, sources: { musicbrainz: enabled, wikidata: enabled, ...sources.enabled } }),
    calibration: currentCalibration
  };
}

function loadSamples(file) {
  const records = new Map();
  if (!file) return records;
  try {
    for (const record of JSON.parse(readFileSync(file, "utf8"))) {
      const key = albumKey(record.artist, record.album);
      records.set(key, { ...record, key, sample: true });
    }
  } catch (error) {
    console.error("acclaim: could not load sample records", error);
  }
  return records;
}
