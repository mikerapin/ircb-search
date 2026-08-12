import { it, expect, describe } from "vitest";
import { normalizeSeries, seriesKey, pickDisplayNames, yearSensitiveKeys } from "../../src/data/series";

it("strips issue/vol/year/ft noise", () => {
  expect(normalizeSeries("Batman #50")).toBe("Batman");
  expect(normalizeSeries("Batman #1-6")).toBe("Batman");
  expect(normalizeSeries("Saga, Vol. 2")).toBe("Saga");
  expect(normalizeSeries("X-Men (1991) #4")).toBe("X-Men");
  expect(normalizeSeries("Something ft. Ed Brubaker")).toBe("Something");
  expect(normalizeSeries("Ice Cream Man volumes 1-9")).toBe("Ice Cream Man");
  expect(normalizeSeries("Giant Days Book 3")).toBe("Giant Days");
});

it("strips manga chapter numbering", () => {
  // Real headings: the index logs manga by chapter the way it logs comics by issue.
  expect(normalizeSeries("Haikyu!! Chapter 381")).toBe("Haikyu!!");
  expect(normalizeSeries("Black Clover Chapter 192")).toBe("Black Clover");
  expect(normalizeSeries("One Piece Ch. 1044")).toBe("One Piece");
});

it("strips scraped show-note HTML fragments", () => {
  expect(normalizeSeries("Wonder Woman Special #1.</P><P><STRONG")).toBe("Wonder Woman Special");
  expect(normalizeSeries("Daredevil   \n  #7")).toBe("Daredevil");
});

it("never returns empty for a non-empty input", () => {
  expect(normalizeSeries("#1")).toBe("#1");
  expect(normalizeSeries("")).toBe("");
});

describe("seriesKey — groups headings that differ only in punctuation or case", () => {
  const same = (a: string, b: string) => expect(seriesKey(a)).toBe(seriesKey(b));
  const differ = (a: string, b: string) => expect(seriesKey(a)).not.toBe(seriesKey(b));

  it("folds subtitle separators", () => {
    same("Star Wars: Visions", "Star Wars Visions");
    same("Star Wars: Doctor Aphra", "Star Wars - Doctor Aphra");
    same("Batman Universe", "Batman: Universe");
    same("X-Men Gold", "X-Men: Gold");
    same("Catwoman: Lonely City", "Catwoman Lonely City");
  });

  it("folds smart quotes, case and trailing punctuation", () => {
    same("We Only Find Them When They’re Dead", "We Only Find Them When They're Dead");
    same("We only Find Them When They’re Dead", "We Only Find Them When They're Dead");
    same("Quantum and Woody!", "Quantum and Woody");
    same("Fantastic Four (", "Fantastic Four");
    // An apostrophe is not a word break: these are one book, not two.
    same("Dead Dog’s Bite", "Dead Dogs Bite");
  });

  it("folds hyphen-vs-space", () => {
    same("All-Star Batman", "All Star Batman");
    same("All-Star Superman", "All Star Superman");
  });

  it("keeps genuinely different series apart", () => {
    // Folding any of these would silently lie about which episodes discussed what.
    differ("Batman Vs Robin", "Batman & Robin");
    differ("Black Cloak", "Black Cloud");
    differ("Black Magick", "Black Magic");
    differ("Monster", "Monsters");
    differ("Immortal Iron Fist", "Immortal Iron Fists");
    differ("The Forged", "The Forge");
    differ("Haikyu!!", "Haikyuu!!");            // romanisation, left split on purpose
    differ("Predator Hunters II", "Predator Hunters III");
    differ("Archie vs Predator", "Archie vs Predator 2");
  });

  it("is stable and non-empty", () => {
    expect(seriesKey("Saga")).toBe(seriesKey("saga"));
    expect(seriesKey("!!!")).toBe("!!!");        // falls back rather than returning ""
    expect(seriesKey("")).toBe("");
  });
});

describe("pickDisplayNames", () => {
  it("gives every variant in a group the most-used spelling", () => {
    const names = ["Star Wars Visions", "Star Wars: Visions", "Star Wars: Visions", "Monster"];
    const map = pickDisplayNames(names);
    expect(map.get(seriesKey("Star Wars Visions"))).toBe("Star Wars: Visions");
    expect(map.get(seriesKey("Monster"))).toBe("Monster");
  });

  it("breaks ties deterministically", () => {
    const a = pickDisplayNames(["Batman Universe", "Batman: Universe"]);
    const b = pickDisplayNames(["Batman: Universe", "Batman Universe"]);
    expect(a.get(seriesKey("Batman Universe"))).toBe(b.get(seriesKey("Batman Universe")));
  });
});

describe("volume years are kept only when they disambiguate", () => {
  it("drops a year that no other volume contradicts", () => {
    // "Daredevil" and "Daredevil (1998)" are one run written two ways.
    const s = yearSensitiveKeys(["Daredevil #7", "Daredevil (1998) #1"]);
    expect(normalizeSeries("Daredevil (1998) #1", s)).toBe("Daredevil");
    expect(seriesKey("Daredevil #7", s)).toBe(seriesKey("Daredevil (1998) #1", s));
  });

  it("keeps the year when the same title carries two of them", () => {
    const v1961 = "Fantastic Four (1961) #51", v2022 = "Fantastic Four (2022) #1";
    const raw = [v1961, v2022, "Fantastic Four #3"];
    const s = yearSensitiveKeys(raw);
    expect(normalizeSeries("Fantastic Four (1961) #51", s)).toBe("Fantastic Four (1961)");
    expect(normalizeSeries("Fantastic Four (2022) #1", s)).toBe("Fantastic Four (2022)");
    // Two different books must not share a page.
    expect(seriesKey(v1961, s)).not.toBe(seriesKey(v2022, s));
    // The undated mentions stay on their own run — we cannot know which volume they meant.
    expect(normalizeSeries("Fantastic Four #3", s)).toBe("Fantastic Four");
  });

  it("is inert without the corpus, so display-only callers are unchanged", () => {
    expect(normalizeSeries("Fantastic Four (1961) #51")).toBe("Fantastic Four");
  });
});
