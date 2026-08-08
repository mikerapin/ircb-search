import { it, expect } from "vitest";
import { normalizeSeries } from "../../src/data/series";

it("strips issue/vol/year/ft noise", () => {
  expect(normalizeSeries("Batman #50")).toBe("Batman");
  expect(normalizeSeries("Batman #1-6")).toBe("Batman");
  expect(normalizeSeries("Saga, Vol. 2")).toBe("Saga");
  expect(normalizeSeries("X-Men (1991) #4")).toBe("X-Men");
  expect(normalizeSeries("Something ft. Ed Brubaker")).toBe("Something");
  expect(normalizeSeries("Ice Cream Man volumes 1-9")).toBe("Ice Cream Man");
  expect(normalizeSeries("Giant Days Book 3")).toBe("Giant Days");
});

it("strips scraped show-note HTML fragments", () => {
  expect(normalizeSeries("Wonder Woman Special #1.</P><P><STRONG")).toBe("Wonder Woman Special");
  expect(normalizeSeries("Daredevil   \n  #7")).toBe("Daredevil");
});

it("never returns empty for a non-empty input", () => {
  expect(normalizeSeries("#1")).toBe("#1");
  expect(normalizeSeries("")).toBe("");
});
