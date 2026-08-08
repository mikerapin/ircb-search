import { it, expect } from "vitest";
import { parseHash, href } from "../../src/router";

it("parses search route", () => {
  const r = parseHash("#/search?q=saga&who=Kara");
  expect(r.seg).toEqual(["search"]);
  expect(r.qs.get("q")).toBe("saga");
  expect(r.qs.get("who")).toBe("Kara");
});

it("parses nested + decodes", () => {
  expect(parseHash("#/series/Ice%20Cream%20Man").seg).toEqual(["series", "Ice Cream Man"]);
  expect(parseHash("#/ep/x:2016-09-21%7Cthe-politics").seg).toEqual(["ep", "x:2016-09-21|the-politics"]);
});

it("builds hrefs", () => {
  expect(href("/search", { q: "saga" })).toBe("#/search?q=saga");
  expect(href("/")).toBe("#/");
  expect(href("/search", { q: "saga", who: "" })).toBe("#/search?q=saga");
});

it("empty/garbage hash → home", () => {
  expect(parseHash("").seg).toEqual([]);
  expect(parseHash("#garbage").seg).toEqual(["garbage"]);
  expect(parseHash("#/").seg).toEqual([]);
});

it("survives a malformed escape without throwing", () => {
  expect(parseHash("#/series/100%").seg).toEqual(["series", "100%"]);
});
