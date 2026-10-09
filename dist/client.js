/** A non-2xx answer from the API (or a network failure after the retries). */
export class ApiError extends Error {
    status;
    code;
    body;
    constructor(message, status, code, body) {
        super(message);
        this.status = status;
        this.code = code;
        this.body = body;
        this.name = 'ApiError';
    }
}
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
/** Retry-After (seconds or an HTTP date) → ms, capped at 60s. */
export function retryAfterMs(header, now = Date.now()) {
    if (!header)
        return null;
    const s = Number(header);
    if (Number.isFinite(s))
        return Math.min(60_000, Math.max(0, s * 1000));
    const at = Date.parse(header);
    return Number.isNaN(at) ? null : Math.min(60_000, Math.max(0, at - now));
}
/** Pull a readable message + machine code out of the API's error body. */
function describe(body, status) {
    const b = (body ?? {});
    const inner = b.message && typeof b.message === 'object' ? b.message : b;
    const message = typeof inner.message === 'string'
        ? inner.message
        : typeof b.message === 'string'
            ? b.message
            : `HTTP ${status}`;
    const code = typeof inner.code === 'string' ? inner.code : undefined;
    return { message, code };
}
/**
 * The TestWatch `/v1` client. 429 / 5xx / network errors are retried (exponential backoff +
 * jitter, honouring Retry-After); a 4xx is final. Never logs the key.
 */
export function createClient(deps) {
    const f = deps.fetch ?? fetch;
    const sleep = deps.sleep ?? sleepReal;
    const retries = deps.retries ?? 5;
    const base = deps.baseUrl.replace(/\/+$/, '');
    async function request(method, path, opts = {}) {
        let attempt = 0;
        for (;;) {
            let res = null;
            let netErr = null;
            try {
                res = await f(`${base}${path}`, {
                    method,
                    headers: {
                        authorization: `Bearer ${deps.apiKey}`,
                        'user-agent': `testwatch-cli/${deps.version ?? 'dev'}`,
                        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
                        ...opts.headers,
                    },
                    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                });
            }
            catch (e) {
                netErr = e;
            }
            const transient = !res || res.status === 429 || res.status >= 500;
            if (!transient && res) {
                if (res.ok)
                    return (opts.raw ? await res.text() : await res.json());
                const body = await res.json().catch(() => null);
                const d = describe(body, res.status);
                throw new ApiError(d.message, res.status, d.code, body);
            }
            if (attempt >= retries) {
                if (res) {
                    const body = await res.json().catch(() => null);
                    const d = describe(body, res.status);
                    throw new ApiError(d.message, res.status, d.code, body);
                }
                throw new ApiError(`Network error: ${String(netErr?.message ?? netErr)}`, 0);
            }
            const backoff = Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
            const wait = retryAfterMs(res?.headers.get('retry-after') ?? null) ?? Math.round(backoff);
            deps.onRetry?.(res ? `HTTP ${res.status}` : 'network error', wait);
            attempt++;
            await sleep(wait);
        }
    }
    return {
        request,
        get: (path) => request('GET', path),
        post: (path, body, headers) => request('POST', path, { body: body ?? {}, headers }),
        text: (path) => request('GET', path, { raw: true }),
    };
}
