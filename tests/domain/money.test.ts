import { describe, expect, it } from "vitest";
import { InvalidMoneyError, formatBRL, formatBps, parseBRL } from "@/domain/money";

describe("parseBRL", () => {
  it.each([
    ["1.234,56", 123456],
    ["R$ 1.234,56", 123456],
    ["1234,5", 123450],
    ["1234.56", 123456],
    ["1.234", 123400],
    ["0,99", 99],
  ])("parses %s", (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1,2,3", "12,345"])("rejects %j", (input) => {
    expect(() => parseBRL(input)).toThrow(InvalidMoneyError);
  });
});

describe("format", () => {
  it("formats BRL", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
  });
  it("formats basis points", () => {
    expect(formatBps(2000)).toBe("20,00%");
  });
});

import { parsePercentBps } from "@/domain/money";

describe("parsePercentBps", () => {
  it.each([["20", 2000], ["20,5", 2050], ["20.5", 2050], ["20%", 2000], ["0", 0], ["7,25", 725]])("parses %s", (i, e) => {
    expect(parsePercentBps(i as string)).toBe(e);
  });
  it.each(["", "abc", "-1", "1,234", "10,5,5"])("rejects %j", (i) => {
    expect(() => parsePercentBps(i)).toThrow(InvalidMoneyError);
  });
});
