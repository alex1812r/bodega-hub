import {
  PURCHASE_SCAN_MAX_CANDIDATES,
  readPurchaseLineScan,
  readValueBeforeCode,
} from "./purchaseLineScan";

const CODE = "7598765432101";

/** Instantes de cada tecla: `gaps[i]` es la pausa antes de la tecla `i`. Devuelve también el del Enter. */
function timeline(gaps: number[], enterGap = 4) {
  let now = 1_000_000;
  const stamps = gaps.map((gap) => (now += gap));

  return { now: now + enterGap, stamps };
}

function burst(length: number, firstGap = 4) {
  return [firstGap, ...Array.from({ length: length - 1 }, () => 4)];
}

describe("readPurchaseLineScan", () => {
  it("con menos de 8 dígitos, o con algo que no sea un dígito, no hay escaneo", () => {
    expect(readPurchaseLineScan("1234567", [], 0)).toBeNull();
    expect(readPurchaseLineScan("12345678,5", [], 0)).toBeNull();
    expect(readPurchaseLineScan("", [], 0)).toBeNull();
  });

  it("«2» a mano y la ráfaga entera: primero el corte del tiempo, luego 13, 12, 14, 8 y el resto de mayor a menor", () => {
    const text = `2${CODE}`;
    const { now, stamps } = timeline([300, ...burst(13, 400)]);

    expect(readPurchaseLineScan(text, stamps, now)).toEqual({
      candidates: [
        CODE,
        text.slice(-12),
        text,
        text.slice(-8),
        text.slice(-11),
        text.slice(-10),
        text.slice(-9),
      ],
      typedValue: 2,
    });
  });

  it("ráfaga partida por un atasco de 80 ms: el corte del tiempo es solo el tramo final, y el sufijo de 13 va justo después", () => {
    const text = `2${CODE}`;
    const { now, stamps } = timeline([300, ...burst(4, 400), ...burst(9, 80)]);
    const scan = readPurchaseLineScan(text, stamps, now);

    expect(scan?.candidates.slice(0, 2)).toEqual(["765432101", CODE]);
    // «7598» llegó a ritmo de ráfaga: no es parte de lo tecleado a mano.
    expect(scan?.typedValue).toBe(2);
  });

  it("si el tramo final no llega a 8 dígitos, el corte del tiempo es el texto entero", () => {
    const { now, stamps } = timeline([...burst(9), ...burst(4, 80)]);

    expect(readPurchaseLineScan(CODE, stamps, now)).toEqual({
      candidates: [CODE, CODE.slice(-12), CODE.slice(-8), CODE.slice(-11), CODE.slice(-10), CODE.slice(-9)],
      typedValue: null,
    });
  });

  it("sin tiempos (pegado) propone el texto entero y sus sufijos, y no hay valor tecleado", () => {
    expect(readPurchaseLineScan(`3${CODE}`, [], 0)).toEqual({
      candidates: [
        `3${CODE}`,
        CODE,
        CODE.slice(-12),
        CODE.slice(-8),
        CODE.slice(-11),
        CODE.slice(-10),
        CODE.slice(-9),
      ],
      typedValue: null,
    });
  });

  it("nunca propone más de 8 códigos ni uno de menos de 8 dígitos", () => {
    const text = "12345678901234567890";
    const scan = readPurchaseLineScan(text, [], 0);

    expect(scan?.candidates).toEqual([
      text,
      text.slice(-13),
      text.slice(-12),
      text.slice(-14),
      text.slice(-8),
      text.slice(-19),
      text.slice(-18),
      text.slice(-17),
    ]);
    expect(scan?.candidates).toHaveLength(PURCHASE_SCAN_MAX_CANDIDATES);
  });

  it("lo tecleado a mano solo vale hasta 6 dígitos y mayor que 0", () => {
    const slow = (length: number) => Array.from({ length }, () => 200);
    const typed = (prefix: string) => {
      const { now, stamps } = timeline([...slow(prefix.length), ...burst(13, 400)]);

      return readPurchaseLineScan(`${prefix}${CODE}`, stamps, now)?.typedValue;
    };

    expect(typed("150")).toBe(150);
    expect(typed("123456")).toBe(123456);
    expect(typed("1234567")).toBeNull();
    expect(typed("0")).toBeNull();
  });

  it("un valor que ya estaba en la celda (sin instante) cuenta como tecleado a mano", () => {
    const { stamps, now } = timeline(burst(13));

    expect(readPurchaseLineScan(`15${CODE}`, [-Infinity, -Infinity, ...stamps], now)?.typedValue).toBe(15);
  });
});

describe("readValueBeforeCode", () => {
  it("da lo que queda delante del código si es un entero de 1 a 6 dígitos mayor que 0", () => {
    expect(readValueBeforeCode(`2${CODE}`, CODE)).toBe(2);
    expect(readValueBeforeCode(`123456${CODE}`, CODE)).toBe(123456);
    expect(readValueBeforeCode(CODE, CODE)).toBeNull();
    expect(readValueBeforeCode(`0${CODE}`, CODE)).toBeNull();
    expect(readValueBeforeCode(`1234567${CODE}`, CODE)).toBeNull();
  });
});
