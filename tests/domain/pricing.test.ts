import { describe, expect, it } from "vitest";
import { belowMinimum, lineMarginBps, lineNetCents, salePriceCents } from "@/domain/pricing";

describe("salePriceCents", () => {
  it("applies margin on the sale price", () => {
    expect(salePriceCents(100000, 2000, 0)).toBe(125000);
  });
  it("includes taxes and rounds up", () => {
    expect(salePriceCents(100000, 2000, 1000)).toBe(142858);
  });
  it("handles zero cost", () => {
    expect(salePriceCents(0, 2000, 0)).toBe(0);
  });
  it("rejects invalid input", () => {
    expect(() => salePriceCents(100000, 9000, 1000)).toThrow(RangeError);
    expect(() => salePriceCents(-1, 2000, 0)).toThrow(RangeError);
    expect(() => salePriceCents(10.5, 2000, 0)).toThrow(RangeError);
  });
});

describe("lineNetCents", () => {
  it("applies discount to the line total", () => {
    expect(lineNetCents(125000, 3, 500)).toBe(356250);
  });
});

describe("lineMarginBps", () => {
  it("computes effective margin", () => {
    expect(lineMarginBps(100000, 1, 125000, 0)).toBe(2000);
  });
  it("returns null when net is zero (100% discount)", () => {
    expect(lineMarginBps(100000, 1, 0, 0)).toBeNull();
  });
});

describe("belowMinimum", () => {
  it("treats null as below minimum", () => {
    expect(belowMinimum(null, 1000)).toBe(true);
  });
  it("compares against the minimum", () => {
    expect(belowMinimum(999, 1000)).toBe(true);
    expect(belowMinimum(1000, 1000)).toBe(false);
  });
});
