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
      typedUnclear: false,
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
      typedUnclear: false,
      typedValue: null,
    });
  });

  it("sin tiempos (pegado) propone los mismos sufijos, y no hay valor tecleado", () => {
    expect(readPurchaseLineScan(`3${CODE}`, [], 0)).toEqual({
      candidates: [CODE, CODE.slice(-12), `3${CODE}`, CODE.slice(-8)],
      typedUnclear: false,
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

// COM-F10 · F-A1: un costo con decimales tecleado antes del escaneo se perdía.
describe("valor con decimales delante del código (COM-F10 · F-A1)", () => {
  const slow = (length: number) => Array.from({ length }, () => 130);

  /** `typed` a mano (130 ms por tecla) y luego el código en ráfaga. Los instantes son solo de los dígitos. */
  function read(typed: string, codeGaps = burst(13, 400)) {
    const digits = typed.replace(".", "").length;
    const { now, stamps } = timeline([...slow(digits), ...codeGaps]);

    return readPurchaseLineScan(`${typed}${CODE}`, stamps, now);
  }

  it("«55.5» + código: el código sale de los decimales y lo tecleado es 55.5", () => {
    expect(read("55.5")).toEqual({
      candidates: [CODE, CODE.slice(-12), `5${CODE}`, CODE.slice(-8)],
      typedUnclear: false,
      typedValue: 55.5,
    });
  });

  it("«0.75», «1200.50» y «12.» (separador colgando = 12)", () => {
    expect(read("0.75")?.typedValue).toBe(0.75);
    expect(read("1200.50")?.typedValue).toBe(1200.5);
    expect(read("12.")).toMatchObject({ typedUnclear: false, typedValue: 12 });
    expect(read("12.")?.candidates[0]).toBe(CODE);
  });

  it("ráfaga partida por un atasco: los decimales tecleados despacio siguen siendo el valor", () => {
    const reading = read("55.5", [...burst(5, 400), ...burst(8, 110)]);

    expect(reading?.candidates[0]).toBe(CODE);
    expect(reading).toMatchObject({ typedUnclear: false, typedValue: 55.5 });
  });

  it("decimales tecleados a ritmo de ráfaga: no se sabe dónde acaba el valor", () => {
    const { now, stamps } = timeline([130, 130, ...burst(14, 130)]);

    expect(readPurchaseLineScan(`55.5${CODE}`, stamps, now)).toMatchObject({
      candidates: [CODE, CODE.slice(-12), `5${CODE}`, CODE.slice(-8)],
      typedUnclear: true,
    });
  });

  it("sin instantes de tecla y con separador tampoco se sabe", () => {
    expect(readPurchaseLineScan(`55.5${CODE}`, [], 0)?.typedUnclear).toBe(true);
  });

  it("un costo que ya estaba en la celda («1020.00») y el código detrás: el valor es el que estaba", () => {
    const { now, stamps } = timeline(burst(13));
    const there = Array.from({ length: 6 }, () => -Infinity);

    expect(readPurchaseLineScan(`1020.00${CODE}`, [...there, ...stamps], now)).toMatchObject({
      typedUnclear: false,
      typedValue: 1020,
    });
  });

  it("readValueBeforeCode lee el decimal que queda delante del código que existía", () => {
    expect(readValueBeforeCode(`55.5${CODE}`, CODE)).toBe(55.5);
    expect(readValueBeforeCode(`0.75${CODE}`, CODE)).toBe(0.75);
    expect(readValueBeforeCode(`12.${CODE}`, CODE)).toBe(12);
    expect(readValueBeforeCode(`55.555${CODE}`, CODE)).toBe(55.56);
    expect(readValueBeforeCode(`.${CODE}`, CODE)).toBeNull();
  });
});
