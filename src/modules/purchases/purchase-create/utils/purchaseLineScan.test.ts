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

  // COM-F8 · 2c: antes iba primero el corte del tiempo y se consultaban hasta 8 sufijos.
  it("«2» a mano y la ráfaga entera: los sufijos de 13, 12, 14 y 8 dígitos, en ese orden y nada más", () => {
    const text = `2${CODE}`;
    const { now, stamps } = timeline([300, ...burst(13, 400)]);

    expect(readPurchaseLineScan(text, stamps, now)).toEqual({
      candidates: [CODE, text.slice(-12), text, text.slice(-8)],
      typedValue: 2,
    });
  });

  it("ráfaga partida por un atasco de 80 ms: el sufijo de 13 sigue yendo primero y el tramo final suelto no se consulta", () => {
    const text = `2${CODE}`;
    const { now, stamps } = timeline([300, ...burst(4, 400), ...burst(9, 80)]);
    const scan = readPurchaseLineScan(text, stamps, now);

    expect(scan?.candidates).toEqual([CODE, text.slice(-12), text, text.slice(-8)]);
    // «7598» llegó a ritmo de ráfaga: no es parte de lo tecleado a mano.
    expect(scan?.typedValue).toBe(2);
  });

  it("un EAN-13 solo: él mismo, sus sufijos de 12 y 8, y nada más", () => {
    const { now, stamps } = timeline([...burst(9), ...burst(4, 80)]);

    expect(readPurchaseLineScan(CODE, stamps, now)).toEqual({
      candidates: [CODE, CODE.slice(-12), CODE.slice(-8)],
      typedValue: null,
    });
  });

  it("sin tiempos (pegado) propone los mismos sufijos, y no hay valor tecleado", () => {
    expect(readPurchaseLineScan(`3${CODE}`, [], 0)).toEqual({
      candidates: [CODE, CODE.slice(-12), `3${CODE}`, CODE.slice(-8)],
      typedValue: null,
    });
  });

  it("un código de otro largo (10 dígitos) se consulta entero después de su sufijo de 8", () => {
    const { now, stamps } = timeline(burst(10));

    expect(readPurchaseLineScan("4012345678", stamps, now)?.candidates).toEqual([
      "12345678",
      "4012345678",
    ]);
  });

  it("nunca propone más de 4 códigos ni uno de menos de 8 dígitos", () => {
    const text = "12345678901234567890";
    const scan = readPurchaseLineScan(text, [], 0);

    expect(scan?.candidates).toEqual([
      text.slice(-13),
      text.slice(-12),
      text.slice(-14),
      text.slice(-8),
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
