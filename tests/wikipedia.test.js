import test from "node:test";
import assert from "node:assert/strict";
import { parseWikipediaRatings, scoreCellText, splitTemplateParams } from "../server/acclaim/wikipedia.js";

const article = `
'''Blonde''' is the second studio album...
{{Infobox album | name = Blonde }}
== Critical reception ==
{{Music ratings
| MC = 87/100<ref name="mc">{{cite web |url=https://example.org |title=Blonde}}</ref>
| ADM = 8.1/10<ref>{{cite web|title=x}}</ref>
| rev1 = [[AllMusic]]
| rev1score = {{Rating|4.5|5}}<ref>{{cite web |last=Kellman}}</ref>
| rev2 = ''[[The A.V. Club]]''
| rev2score = A−
| rev3 = ''[[The Guardian]]''
| rev3score = {{Rating|4|5}}
| rev4 = ''[[Pitchfork (website)|Pitchfork]]''
| rev4score = 9.0/10
| rev5 = ''[[Rolling Stone]]''
| rev5score = {{Rating-5|4}}
| rev6 = ''[[The Village Voice]]''
| rev6score = {{Rating|3|5}}<!-- disputed -->
| rev7 = Some blog
| rev7score = great
}}
Blonde received widespread acclaim...
`;

test("reads outlets and scores from the Music ratings box", () => {
  const reviews = parseWikipediaRatings(article);
  const byKey = Object.fromEntries(reviews.map((review) => [review.source, review.score]));
  assert.equal(byKey.metacritic, 87);
  assert.equal(byKey.anydecentmusic, 81);
  assert.equal(byKey.allmusic, 90);
  assert.equal(byKey.pitchfork, 90);
  assert.equal(byKey["the guardian"], 80);
  assert.equal(byKey["rolling stone"], 80);
  assert.equal(byKey["the village voice"], 60);
  assert.equal(byKey["some blog"], undefined, "unparsable scores are skipped");
  assert.ok(reviews.every((review) => review.via === "wikipedia"));
});

test("letter grades written with a typographic minus still parse", () => {
  const reviews = parseWikipediaRatings(article);
  const avClub = reviews.find((review) => review.source === "the a.v. club");
  assert.ok(avClub, "outlets outside the table are accepted from Wikipedia");
  assert.equal(avClub.score, 90);
});

test("articles without a ratings box yield nothing", () => {
  assert.deepEqual(parseWikipediaRatings("No box here {{Infobox album}}"), []);
});

test("template parameters split on top-level pipes only", () => {
  const params = splitTemplateParams("Music ratings | rev1 = [[A|B]] | rev1score = {{Rating|4|5}}");
  assert.equal(params.rev1, "[[A|B]]");
  assert.equal(params.rev1score, "{{Rating|4|5}}");
  assert.equal(scoreCellText("{{Rating|3.5|5}}<ref>x</ref>"), "3.5/5");
});
