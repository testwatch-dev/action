/** "90s" | "30m" | "1h" | "1500ms" | "120" (seconds) → ms; null when unreadable. */
export function parseDuration(raw) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/i.exec(raw);
    if (!m)
        return null;
    const n = Number(m[1]);
    const unit = (m[2] ?? 's').toLowerCase();
    const mult = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
    const ms = Math.round(n * mult);
    return ms > 0 ? ms : null;
}
export function fmtDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60)
        return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}
