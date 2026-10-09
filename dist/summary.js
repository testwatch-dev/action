import { fmtDuration } from './duration.js';
export const VERDICT_TEXT = {
    pass: 'Passed',
    real_bug: 'Real bug found',
    needs_review: 'Needs review',
    infra: "Couldn't test",
};
const ICON = {
    pass: '✅',
    real_bug: '🐞',
    needs_review: '🔍',
    infra: '⚠️',
    pending: '⏳',
    ignored: '⏭️',
};
const problem = (r) => r.verdict === 'real_bug' || r.verdict === 'needs_review' || r.verdict === 'infra';
/** One progress line while waiting. Pure. */
export function progressLine(run) {
    const c = run.counts;
    const state = run.finishedAt
        ? run.final
            ? 'final'
            : `waiting for triage (${c.pending} pending)`
        : `${run.status}`;
    return `  ${state} · ${c.pass} passed · ${c.realBug} real bug · ${c.needsReview} needs review · ${c.infra} couldn't test · of ${c.total}`;
}
/** The final console report. Pure. */
export function consoleReport(run) {
    const lines = [
        `${ICON[run.verdict]} TestWatch: ${VERDICT_TEXT[run.verdict]}${run.final ? '' : ' (provisional)'}`,
        progressLine(run),
    ];
    for (const r of run.results.filter(problem)) {
        lines.push(`  ${ICON[r.verdict]} ${r.title} [${r.device}] — ${r.verdict}`);
        if (r.error)
            lines.push(`      ${r.error.split('\n')[0].slice(0, 200)}`);
        lines.push(`      ${r.url}`);
    }
    lines.push(`  ${run.url}`);
    return lines.join('\n');
}
const md = (s) => s.replace(/[|<>]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
/** `$GITHUB_STEP_SUMMARY` markdown. Pure. */
export function markdownSummary(run) {
    const c = run.counts;
    const out = [
        `## ${ICON[run.verdict]} TestWatch: ${VERDICT_TEXT[run.verdict]}${run.final ? '' : ' (provisional)'}`,
        '',
        `| Passed | Real bug | Needs review | Couldn't test | Flaky | Total |`,
        '|---|---|---|---|---|---|',
        `| ${c.pass} | ${c.realBug} | ${c.needsReview} | ${c.infra} | ${c.flaky} | ${c.total} |`,
        '',
    ];
    const bad = run.results.filter(problem);
    if (bad.length) {
        out.push('| Test | Device | Verdict | Duration |', '|---|---|---|---|');
        for (const r of bad.slice(0, 50)) {
            out.push(`| [${md(r.title)}](${r.url}) | ${r.device} | ${ICON[r.verdict]} ${r.verdict} | ${r.durationMs != null ? fmtDuration(r.durationMs) : '—'} |`);
        }
        if (bad.length > 50)
            out.push('', `…and ${bad.length - 50} more.`);
        out.push('');
    }
    out.push(`[Open the run in TestWatch](${run.url})`, '');
    return out.join('\n');
}
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
/** GitHub workflow annotations, one per failing test. Pure. */
export function githubAnnotations(run) {
    return run.results
        .filter(problem)
        .slice(0, 50)
        .map((r) => {
        const level = r.verdict === 'real_bug' ? 'error' : 'warning';
        const title = escProp(`TestWatch ${r.verdict}: ${r.title}`);
        return `::${level} title=${title}::${esc(`${r.error ?? VERDICT_TEXT[r.verdict]}\n${r.url}`)}`;
    });
}
