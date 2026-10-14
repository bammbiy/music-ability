import test from "node:test";
import assert from "node:assert/strict";
import { SCORE_WEIGHTS } from "../server/analysis.js";
import { learnWeights, targetScore } from "../server/learning.js";

// Simulated users who feel the score is too high when it leans on diversity
// and too low when it leans on critic taste.
function simulate(count) {
  const feedback = [];
  for (let index = 0; index < count; index += 1) {
    const diversity = (index * 37) % 100;
    const criticTaste = (index * 61) % 100;
    const metrics = { diversity, detailDepth: 50, discovery: 50, concentration: 50, newReleaseSense: 50, criticTaste, hiddenGems: 50 };
    const sum = Object.values(SCORE_WEIGHTS).reduce((total, value) => total + value, 0);
    const score = Math.round(Object.entries(SCORE_WEIGHTS).reduce((total, [key, weight]) => total + metrics[key] * weight, 0) / sum);
    const wanted = score - (diversity - 50) * 0.1 + (criticTaste - 50) * 0.1;
    const rating = Math.max(1, Math.min(5, Math.round(3 - (wanted - score) / 8)));
    feedback.push({ rating, score, metrics });
  }
  return feedback;
}

test("the target score follows the feedback direction", () => {
  assert.equal(targetScore(60, 3), 60);
  assert.equal(targetScore(60, 1), 76);
  assert.equal(targetScore(60, 5), 44);
  assert.equal(targetScore(98, 1), 100);
});

test("too little feedback keeps the current weights", () => {
  const result = learnWeights(simulate(10));
  assert.equal(result.ready, false);
  assert.deepEqual(result.weights, SCORE_WEIGHTS);
});

test("weights move toward what users report, within a limited band", () => {
  const result = learnWeights(simulate(400));
  assert.equal(result.ready, true);
  assert.ok(result.weights.diversity < SCORE_WEIGHTS.diversity, "diversity weight goes down");
  assert.ok(result.weights.criticTaste > SCORE_WEIGHTS.criticTaste, "critic weight goes up");
  assert.ok(result.after <= result.before);
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    assert.ok(Math.abs(result.weights[key] - weight) <= weight * 0.35, `${key} stays near its default`);
  }
  const sum = Object.values(result.weights).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(sum - 1) < 0.01);
});

test("feedback saying the score is right changes nothing", () => {
  const steady = simulate(200).map((entry) => ({ ...entry, rating: 3 }));
  const result = learnWeights(steady);
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    assert.ok(Math.abs(result.weights[key] - weight) < 0.01, key);
  }
});
