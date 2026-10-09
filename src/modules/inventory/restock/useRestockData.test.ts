/** INV-05 · tope de concurrencia de las consultas de proveedores. */
import { createConcurrencyLimiter } from "./useRestockData";

type Deferred = { reject: (error: Error) => void; resolve: (value: string) => void };

describe("createConcurrencyLimiter", () => {
  it("no ejecuta más de `max` tareas a la vez y respeta el orden de llegada", async () => {
    const limit = createConcurrencyLimiter(2);
    const started: number[] = [];
    const deferred: Deferred[] = [];
    let running = 0;
    let peak = 0;

    const results = [0, 1, 2, 3, 4].map((index) =>
      limit(
        () =>
          new Promise<string>((resolve, reject) => {
            started.push(index);
            running += 1;
            peak = Math.max(peak, running);
            deferred[index] = {
              reject,
              resolve: (value) => {
                running -= 1;
                resolve(value);
              },
            };
          }),
      ),
    );

    expect(started).toEqual([0, 1]);

    deferred[0].resolve("a");
    await results[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    deferred[1].resolve("b");
    deferred[2].resolve("c");
    await Promise.all([results[1], results[2]]);
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    deferred[3].resolve("d");
    deferred[4].resolve("e");

    await expect(Promise.all(results)).resolves.toEqual(["a", "b", "c", "d", "e"]);
    expect(peak).toBe(2);
  });

  it("una tarea que falla libera su turno y propaga el error", async () => {
    const limit = createConcurrencyLimiter(1);
    const failing = limit(() => Promise.reject(new Error("sin red")));
    const next = limit(() => Promise.resolve("ok"));

    await expect(failing).rejects.toThrow("sin red");
    await expect(next).resolves.toBe("ok");
  });
});
