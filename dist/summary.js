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
const fixOf = (r) => (r.fix && typeof r.fix === 'object' ? r.fix : null);
const isProposed = (f) => !!f && f.status === 'proposed' && !f.ran;
const ranFix = (r) => !!fixOf(r)?.ran;
const ranSuffix = (r) => (ranFix(r) ? ' (ran with accepted PR fix)' : '');
/** Results whose PR fix this run proposed (accept it in TestWatch, then re-run). Pure. */
export function proposedFixes(run) {
    const out = [];
    for (const r of run.results ?? []) {
        const f = fixOf(r);
        if (isProposed(f))
            out.push({ result: r, fix: f });
    }
    return out;
}
/** "Preview · host" for a preview run, else null. Pure. */
export function previewLabel(run) {
    if (!run.preview)
        return null;
    let host = run.targetUrl ?? '';
    try {
        if (run.targetUrl)
            host = new URL(run.targetUrl).host;
    }
    catch {
        // keep the raw value
    }
    return host ? `Preview · ${host}` : 'Preview';
}
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
    const preview = previewLabel(run);
    const lines = [
        `${ICON[run.verdict]} TestWatch: ${VERDICT_TEXT[run.verdict]}${run.final ? '' : ' (provisional)'}${preview ? ` · ${preview}` : ''}`,
        progressLine(run),
    ];
    for (const r of run.results.filter(problem)) {
        lines.push(`  ${ICON[r.verdict]} ${r.title} [${r.device}] — ${r.verdict}${ranSuffix(r)}`);
        if (r.error)
            lines.push(`      ${r.error.split('\n')[0].slice(0, 200)}`);
        lines.push(`      ${r.url}`);
        const f = fixOf(r);
        if (isProposed(f))
            lines.push(`  PR fix proposed — accept: ${f.url}`);
    }
    const ranPassing = run.results.filter((r) => !problem(r) && ranFix(r)).length;
    if (ranPassing)
        lines.push(`  ${ranPassing} passing test(s) ran with an accepted PR fix`);
    lines.push(`  ${run.url}`);
    return lines.join('\n');
}
const md = (s) => s.replace(/[|<>]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
/** `$GITHUB_STEP_SUMMARY` markdown. Pure. */
export function markdownSummary(run) {
    const c = run.counts;
    const preview = previewLabel(run);
    const out = [
        `## ${ICON[run.verdict]} TestWatch: ${VERDICT_TEXT[run.verdict]}${run.final ? '' : ' (provisional)'}`,
        '',
        ...(preview ? [`**${md(preview)}**`, ''] : []),
        `| Passed | Real bug | Needs review | Couldn't test | Flaky | Total |`,
        '|---|---|---|---|---|---|',
        `| ${c.pass} | ${c.realBug} | ${c.needsReview} | ${c.infra} | ${c.flaky} | ${c.total} |`,
        '',
    ];
    const bad = run.results.filter(problem);
    if (bad.length) {
        out.push('| Test | Device | Verdict | Duration |', '|---|---|---|---|');
        for (const r of bad.slice(0, 50)) {
            out.push(`| [${md(r.title)}](${r.url})${md(ranSuffix(r))} | ${r.device} | ${ICON[r.verdict]} ${r.verdict} | ${r.durationMs != null ? fmtDuration(r.durationMs) : '—'} |`);
        }
        if (bad.length > 50)
            out.push('', `…and ${bad.length - 50} more.`);
        out.push('');
    }
    const fixes = proposedFixes(run);
    if (fixes.length) {
        out.push('### PR fixes', '', 'TestWatch proposed a fix for these tests on this branch. Accept it, then re-run this job.', '');
        for (const { result: r, fix } of fixes.slice(0, 50)) {
            out.push(`- [${md(r.title)}](${r.url}) [${r.device}] — [Accept the PR fix](${fix.url})${fix.touchesAssertion ? ' (changes an assertion — review it)' : ''}`);
        }
        if (fixes.length > 50)
            out.push('', `…and ${fixes.length - 50} more.`);
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
        const f = fixOf(r);
        const accept = isProposed(f) ? `\nPR fix proposed — accept: ${f.url}` : '';
        return `::${level} title=${title}::${esc(`${r.error ?? VERDICT_TEXT[r.verdict]}${ranSuffix(r)}\n${r.url}${accept}`)}`;
    });
}
