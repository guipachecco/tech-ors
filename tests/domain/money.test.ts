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
