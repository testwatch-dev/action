/** Exit codes (docs/38 §3) — stable: CI configs branch on them. */
export const EXIT = {
    /** Passed, or the verdict isn't in --fail-on, or not waiting. */
    ok: 0,
    /** The final verdict is in --fail-on. */
    failed: 1,
    /** Couldn't start or finish: usage, auth, plan, network, timeout. */
    error: 2,
    /** Interrupted (SIGINT / SIGTERM — e.g. the CI job was cancelled). */
    interrupted: 130,
};
export const VERDICTS = ['pass', 'real_bug', 'needs_review', 'infra'];
/** Default: every non-pass verdict fails the job. */
export const DEFAULT_FAIL_ON = ['real_bug', 'needs_review', 'infra'];
/** `--fail-on real_bug,infra` → the set; `none` → nothing fails; unknown names → error. */
export function parseFailOn(raw) {
    if (raw === undefined || raw.trim() === '')
        return [...DEFAULT_FAIL_ON];
    const names = raw
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase().replace(/-/g, '_'))
        .filter(Boolean);
    if (names.length === 1 && names[0] === 'none')
        return [];
    if (names.includes('any'))
        return [...DEFAULT_FAIL_ON];
    const bad = names.filter((n) => n === 'pass' || !VERDICTS.includes(n));
    if (bad.length) {
        return {
            error: `--fail-on: unknown verdict(s) ${bad.join(', ')} (use real_bug, needs_review, infra, any or none)`,
        };
    }
    return [...new Set(names)];
}
export function exitCodeFor(verdict, failOn) {
    return verdict !== 'pass' && failOn.includes(verdict) ? EXIT.failed : EXIT.ok;
}
