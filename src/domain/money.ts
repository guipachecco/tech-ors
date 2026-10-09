export type Cents = number;
export type Bps = number;

export class InvalidMoneyError extends Error {
  constructor(input: string) {
    super(`Valor monetário inválido: "${input}"`);
    this.name = "InvalidMoneyError";
  }
}

const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;
const PLAIN_DECIMAL_DOT = /^\d+\.\d{1,2}$/;

/** Converte texto em centavos. Aceita "1.234,56", "R$ 1.234,56", "1234.56", "1.234" (milhar). */
export function parseBRL(input: string): Cents {
  const raw = input.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(raw)) throw new InvalidMoneyError(input);

  let intPart: string;
  let fracPart = "";

  if (raw.includes(",")) {
    const pieces = raw.split(",");
    if (pieces.length !== 2) throw new InvalidMoneyError(input);
    const [left, right] = pieces;
    if (!/^\d{1,2}$/.test(right)) throw new InvalidMoneyError(input);
    if (!(/^\d+$/.test(left) || THOUSANDS.test(left))) throw new InvalidMoneyError(input);
    intPart = left.replace(/\./g, "");
    fracPart = right;
  } else if (raw.includes(".")) {
    if (THOUSANDS.test(raw)) {
      intPart = raw.replace(/\./g, "");
    } else if (PLAIN_DECIMAL_DOT.test(raw)) {
      [intPart, fracPart] = raw.split(".");
    } else {
      throw new InvalidMoneyError(input);
    }
  } else {
    intPart = raw;
  }

  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new InvalidMoneyError(input);
  return cents;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(c: Cents): string {
  return brl.format(c / 100);
}

export function formatBps(b: Bps): string {
  return `${(b / 100).toFixed(2).replace(".", ",")}%`;
}
