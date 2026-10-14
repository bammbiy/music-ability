// Learns score weights from "does this score feel right?" feedback.
// Pure functions only. The result is a suggestion for a person to review and
// copy into SCORE_WEIGHTS; it is never applied to live scores automatically,
// so everyone's score stays reproducible.

import { SCORE_WEIGHTS } from "./analysis.js";

// Feedback scale: 1 = much too low, 2 = a bit low, 3 = right, 4 = a bit high, 5 = much too high.
const POINTS_PER_STEP = 8;
export const MIN_FEEDBACK = 50;
// Learned weights stay within this share of the defaults, so a small or
// skewed sample cannot reshape the score.
const MAX_SHIFT = 0.3;
const PRIOR_STRENGTH = 40;
const ROUNDS = 300;

// The score the user would have found right.
export function targetScore(score, rating) {
  return Math.max(0, Math.min(100, score + (3 - rating) * POINTS_PER_STEP));
}

// Weighted average over the metrics a result actually had, like the live score.
function predict(metrics, weights) {
  let total = 0;
  let sum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (!Number.isFinite(metrics[key])) continue;
    total += metrics[key] * weight;
    sum += weight;
  }
  return sum ? total / sum : null;
}

function loss(samples, weights, defaults) {
  let error = 0;
  for (const sample of samples) {
    const predicted = predict(sample.metrics, weights);
    if (predicted !== null) error += (predicted - sample.target) ** 2;
  }
  // Pull toward the defaults; the pull fades as feedback grows.
  let prior = 0;
  for (const [key, weight] of Object.entries(weights)) prior += ((weight - defaults[key]) / defaults[key]) ** 2;
  return error / samples.length + (PRIOR_STRENGTH * 100 * prior) / samples.length;
}

function normalize(weights) {
  const sum = Object.values(weights).reduce((total, value) => total + value, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Math.round((value / sum) * 1000) / 1000]));
}

// feedback: [{ rating, score, metrics }] from listScoreFeedback().
// Returns { ready, samples, weights, before, after } where before/after are
// the mean absolute gap (in points) between the score and what users wanted.
export function learnWeights(feedback, defaults = SCORE_WEIGHTS, { minSamples = MIN_FEEDBACK } = {}) {
  const samples = feedback
    .filter((entry) => Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 5 && Number.isFinite(entry.score) && entry.metrics)
    .map((entry) => ({ metrics: entry.metrics, target: targetScore(entry.score, entry.rating) }));
  const gap = (weights) => {
    const errors = samples.map((sample) => predict(sample.metrics, weights)).map((value, index) => (value === null ? null : Math.abs(value - samples[index].target))).filter((value) => value !== null);
    return errors.length ? Math.round((errors.reduce((total, value) => total + value, 0) / errors.length) * 10) / 10 : null;
  };

  if (samples.length < minSamples) {
    return { ready: false, samples: samples.length, needed: minSamples, weights: { ...defaults }, before: gap(defaults), after: gap(defaults) };
  }

  // Coordinate search with shrinking multiplicative steps, clamped to the allowed band.
  let weights = { ...defaults };
  let best = loss(samples, weights, defaults);
  let step = 0.1;
  for (let round = 0; round < ROUNDS && step > 0.002; round += 1) {
    let improved = false;
    for (const key of Object.keys(weights)) {
      for (const direction of [1, -1]) {
        const value = Math.min(defaults[key] * (1 + MAX_SHIFT), Math.max(defaults[key] * (1 - MAX_SHIFT), weights[key] * (1 + direction * step)));
        if (value === weights[key]) continue;
        const candidate = { ...weights, [key]: value };
        const candidateLoss = loss(samples, candidate, defaults);
        if (candidateLoss < best) {
          weights = candidate;
          best = candidateLoss;
          improved = true;
        }
      }
    }
    if (!improved) step /= 2;
  }

  const learned = normalize(weights);
  return { ready: true, samples: samples.length, needed: minSamples, weights: learned, before: gap(defaults), after: gap(learned) };
}
