// Suggests SCORE_WEIGHTS from "does the score feel right?" feedback.
// Usage: npm run learn-weights
// Prints a suggestion only; copy it into server/analysis.js after review.

import { SCORE_WEIGHTS } from "../server/analysis.js";
import { learnWeights } from "../server/learning.js";
import { listScoreFeedback } from "../server/store.js";

const result = learnWeights(listScoreFeedback());

console.log(`Score feedback linked to a result: ${result.samples} (need ${result.needed})`);
if (!result.ready) {
  console.log("Not enough feedback yet. Current weights stay as they are.");
  process.exit(0);
}

console.log(`Average gap to what users wanted: ${result.before} -> ${result.after} points\n`);
console.log("metric            current  suggested");
for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
  console.log(`${key.padEnd(18)}${weight.toFixed(3).padStart(7)}  ${result.weights[key].toFixed(3).padStart(9)}`);
}
