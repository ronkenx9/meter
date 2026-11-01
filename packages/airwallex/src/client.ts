// Minimal Airwallex REST client: login with token reuse, JSON calls, typed errors.
// Credentials stay inside this module; callers and the model never see them.

export interface AirwallexConfig {
  clientId: string;
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class AirwallexError extends Error {
  override name = "AirwallexError";
  readonly status: number;
  readonly code: string | undefined;
  readonly path: string;
  readonly body: unknown;

  constructor(status: number, code: string | undefined, message: string, path: string, body: unknown) {
    super(`${path} -> ${status}${code ? ` ${code}` : ""}: ${message}`);
    this.status = status;
    this.code = code;
    this.path = path;
    this.body = body;
  }
}

const SANDBOX = "https://api.sandbox.airwallex.com";
// Re-login a minute before the 30-minute token lapses.
const REFRESH_MARGIN_MS = 60_000;

export class AirwallexClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly config: AirwallexConfig;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AirwallexConfig) {
    this.config = config;
    this.baseUrl = (config.baseUrl ?? SANDBOX).replace(/\/$/, "");
    this.fetchImpl = config.fetch ?? fetch;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AirwallexClient {
    const clientId = env.AWX_CLIENT_ID?.trim();
    const apiKey = env.AWX_API_KEY?.trim();
    if (!clientId || !apiKey) throw new Error("AWX_CLIENT_ID and AWX_API_KEY must be set (see .env.example)");
    const baseUrl = env.AWX_BASE_URL?.trim();
    return new AirwallexClient(baseUrl ? { clientId, apiKey, baseUrl } : { clientId, apiKey });
  }

  /** Expiry of the current token, for logs. Never exposes the token itself. */
  get tokenExpiresAt(): Date | null {
    return this.token ? new Date(this.token.expiresAt) : null;
  }

  async login(): Promise<void> {
    const path = "/api/v1/authentication/login";
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: "POST",
      headers: { "x-client-id": this.config.clientId, "x-api-key": this.config.apiKey },
    });
    const body = await readBody(res);
    if (!res.ok) throw toError(res.status, body, path);
    const { token, expires_at } = body as { token?: string; expires_at?: string };
    if (!token) throw new AirwallexError(res.status, undefined, "login returned no token", path, undefined);
    const parsed = expires_at ? Date.parse(expires_at) : NaN;
    this.token = { value: token, expiresAt: Number.isFinite(parsed) ? parsed : Date.now() + 30 * 60_000 };
  }

  private async bearer(): Promise<string> {
    if (!this.token || this.token.expiresAt - Date.now() < REFRESH_MARGIN_MS) await this.login();
    return this.token!.value;
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const send = async () =>
      this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${await this.bearer()}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let res = await send();
    if (res.status === 401) {
      // Token revoked or clock skew: one fresh login, then give up.
      this.token = null;
      res = await send();
    }
    const parsed = await readBody(res);
    if (!res.ok) throw toError(res.status, parsed, path);
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toError(status: number, body: unknown, path: string): AirwallexError {
  const b = (typeof body === "object" && body !== null ? body : {}) as { code?: string; message?: string };
  return new AirwallexError(status, b.code, b.message ?? (typeof body === "string" ? body.slice(0, 300) : "request failed"), path, body);
}
