import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type JsonRecord = Record<string, unknown>;

export type ApiResponse = {
  ok: boolean;
  status: number;
  body: JsonRecord | null;
};

export type StepLog = {
  phase: string;
  step: string;
  ok: boolean;
  status: number;
  expected?: number | number[];
  error?: unknown;
  at: string;
};

export function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function ingestSetCookie(jar: Map<string, string>, header: string) {
  const pair = header.split(";")[0]?.trim();
  if (!pair) return;
  const eq = pair.indexOf("=");
  if (eq <= 0) return;
  jar.set(pair.slice(0, eq), pair.slice(eq + 1));
}

export class ApiClient {
  readonly baseUrl: string;
  private readonly jar = new Map<string, string>();
  readonly steps: StepLog[] = [];
  /** When ALLOW_DEMO_AUTH=true on server, sends x-demo-role on each request. */
  demoRole: string | null = null;
  demoUserId: string | null = null;

  constructor(baseUrl = process.env.SMOKE_API_BASE_URL ?? "http://localhost:3000") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  get cookieHeader() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async request(path: string, init?: RequestInit): Promise<ApiResponse> {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type") && init?.body) {
      headers.set("content-type", "application/json");
    }
    const cookie = this.cookieHeader;
    if (cookie) {
      headers.set("cookie", cookie);
    }
    if (this.demoRole) {
      headers.set("x-demo-role", this.demoRole);
    }
    if (this.demoUserId) {
      headers.set("x-demo-user-id", this.demoUserId);
    }

    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie") as string]
          : [];

    for (const raw of setCookies) {
      if (raw) ingestSetCookie(this.jar, raw);
    }

    let body: JsonRecord | null = null;
    try {
      body = (await response.json()) as JsonRecord;
    } catch {
      body = null;
    }

    return { ok: response.ok, status: response.status, body };
  }

  async requestBinary(path: string, init?: RequestInit): Promise<ApiResponse> {
    const headers = new Headers(init?.headers);
    const cookie = this.cookieHeader;
    if (cookie) {
      headers.set("cookie", cookie);
    }
    if (this.demoRole) {
      headers.set("x-demo-role", this.demoRole);
    }
    if (this.demoUserId) {
      headers.set("x-demo-user-id", this.demoUserId);
    }

    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type");

    return {
      ok:
        response.ok &&
        buffer.byteLength > 0 &&
        (contentType?.includes("spreadsheetml.sheet") ?? false),
      status: response.status,
      body: {
        data: {
          byteLength: buffer.byteLength,
          contentType,
        },
      },
    };
  }

  async login(email: string, password: string, demoRole?: string) {
    this.demoRole = demoRole ?? null;
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async logout() {
    const res = await this.request("/api/auth/logout", { method: "POST" });
    this.jar.clear();
    this.demoRole = null;
    this.demoUserId = null;
    return res;
  }

  data<T = unknown>(res: ApiResponse): T | undefined {
    const data = res.body?.data;
    return data as T | undefined;
  }

  async step(
    phase: string,
    name: string,
    fn: () => Promise<ApiResponse>,
    options?: { expectStatus?: number | number[]; allowFail?: boolean; requireOkResponse?: boolean },
  ): Promise<ApiResponse> {
    const res = await fn();
    const expected = options?.expectStatus ?? [200, 201];
    const expectedList = Array.isArray(expected) ? expected : [expected];
    const statusOk = expectedList.includes(res.status);
    const ok = statusOk && (options?.requireOkResponse ? res.ok : true);
    const log: StepLog = {
      phase,
      step: name,
      ok: options?.allowFail ? true : ok,
      status: res.status,
      expected: expectedList,
      at: new Date().toISOString(),
    };
    if (!ok && !options?.allowFail) {
      log.error = res.body?.error ?? res.body;
    }
    this.steps.push(log);
    const label = ok || options?.allowFail ? "OK" : "FAIL";
    console.log(`  [${label}] ${phase} :: ${name} -> ${res.status}`);
    if (!ok && !options?.allowFail && res.body?.error) {
      console.log("       ", JSON.stringify(res.body.error));
    }
    return res;
  }
}

export function unwrapId(record: unknown, keys = ["id"]): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  for (const key of keys) {
    const value = (record as JsonRecord)[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function unwrapList(res: ApiResponse): unknown[] {
  const data = res.body?.data as JsonRecord | undefined;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items as unknown[];
  return [];
}
