// Album acclaim service: looks up cached scores, queues missing albums for
// background collection, and keeps a learned per-source calibration.

import { readFileSync } from "node:fs";
import { createSources } from "./sources.js";
import { albumKey, learnSourceCalibration, summarizeAlbum } from "./score.js";
import { getAlbumScores, listAlbumRecords, saveAlbumScore } from "../store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = { ok: 30 * DAY_MS, not_found: 7 * DAY_MS, error: 60 * 60 * 1000 };
const MAX_QUEUE = 2000;
const CALIBRATION_TTL_MS = 30 * 60 * 1000;

export function createAcclaimService({ enabled = true, contact, discogsToken, lastfmKey, sampleFile } = {}) {
  const sources = createSources({ contact, discogsToken, lastfmKey });
  const sampleRecords = loadSamples(sampleFile);
  const queue = [];
  const queued = new Set();
  let running = false;
  let calibration = { value: {}, expiresAt: 0 };

  function lookup(albums, { sample = false } = {}) {
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
    for (const [key, item] of wanted) {
      const hit = cached.get(key);
      if (hit?.status === "ok") {
        summaries.set(key, summarizeAlbum(hit.record, currentCalibration()));
      } else if (hit?.status === "error") {
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
        const { status, record, error } = await sources.collect(item);
        saveAlbumScore({ ...item, status, record, ttlMs: TTL_MS[status] });
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
