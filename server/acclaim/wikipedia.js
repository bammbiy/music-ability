// Parses the professional ratings box of English Wikipedia album articles
// ({{Music ratings}}, formerly {{Album ratings}}). Editors collect the scores
// published by review outlets and aggregators there, with citations, so it is
// the widest open summary of critic reviews. Content is CC BY-SA; the UI links
// back to the article.

import { parseReviewScore, wikipediaOutletFor } from "./score.js";

const TEMPLATE_START = /\{\{\s*(music ratings|album ratings|album reviews)\s*\|/i;

export function extractRatingsTemplate(wikitext) {
  const text = String(wikitext || "");
  const match = TEMPLATE_START.exec(text);
  if (!match) return null;
  let depth = 0;
  for (let index = match.index; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === "{{") {
      depth += 1;
      index += 1;
    } else if (pair === "}}") {
      depth -= 1;
      index += 1;
      if (depth === 0) return text.slice(match.index + 2, index - 1);
    }
  }
  return null;
}

// Splits "name | a = 1 | b = {{x|y}}" on top-level pipes only.
export function splitTemplateParams(body) {
  const params = {};
  let depthCurly = 0;
  let depthSquare = 0;
  let current = "";
  const parts = [];
  for (let index = 0; index < body.length; index += 1) {
    const two = body.slice(index, index + 2);
    if (two === "{{") { depthCurly += 1; current += two; index += 1; continue; }
    if (two === "}}") { depthCurly -= 1; current += two; index += 1; continue; }
    if (two === "[[") { depthSquare += 1; current += two; index += 1; continue; }
    if (two === "]]") { depthSquare -= 1; current += two; index += 1; continue; }
    if (body[index] === "|" && depthCurly === 0 && depthSquare === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += body[index];
  }
  parts.push(current);
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return params;
}

// Wiki markup to plain text: refs and comments removed, links reduced to their label.
export function plainText(value) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/''+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{\s*(?:small|nowrap)\s*\|([^}]*)\}\}/gi, "$1")
    .trim();
}

// Turns a score cell into a string parseReviewScore understands.
export function scoreCellText(value) {
  const text = plainText(value);
  const rating = text.match(/\{\{\s*rating\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)/i);
  if (rating) return `${rating[1]}/${rating[2]}`;
  const legacy = text.match(/\{\{\s*rating-(\d+)\s*\|\s*([\d.,]+)/i);
  if (legacy) return `${legacy[2]}/${legacy[1]}`;
  return text.replace(/\{\{[^}]*\}\}/g, "").trim();
}

// Returns critic reviews ({ source, label, raw, score }) from an article's wikitext.
export function parseWikipediaRatings(wikitext) {
  const body = extractRatingsTemplate(wikitext);
  if (!body) return [];
  const params = splitTemplateParams(body);
  const reviews = [];
  const seen = new Set();
  const add = (outletName, cell) => {
    const outlet = wikipediaOutletFor(outletName);
    if (!outlet || seen.has(outlet.key)) return;
    const raw = scoreCellText(cell);
    const score = parseReviewScore(raw, outlet.scale);
    if (score === null) return;
    seen.add(outlet.key);
    reviews.push({ source: outlet.key, label: outlet.name, raw, score, via: "wikipedia" });
  };

  // Aggregators have dedicated fields.
  if (params.mc) add("Metacritic", params.mc);
  if (params.adm) add("AnyDecentMusic?", params.adm);
  for (let index = 1; index <= 60; index += 1) {
    const outlet = params[`rev${index}`];
    const score = params[`rev${index}score`];
    if (outlet && score) add(plainText(outlet), score);
  }
  for (let index = 1; index <= 10; index += 1) {
    const outlet = params[`aggregate${index}`] ?? params[`agg${index}`];
    const score = params[`aggregate${index}score`] ?? params[`agg${index}score`];
    if (outlet && score) add(plainText(outlet), score);
  }
  return reviews;
}
