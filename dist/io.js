import { appendFile, readFile, writeFile } from 'node:fs/promises';
/** The real process I/O. */
export function nodeIo() {
    return {
        out: (l) => process.stdout.write(`${l}\n`),
        err: (l) => process.stderr.write(`${l}\n`),
        readFile: (p) => readFile(p, 'utf8'),
        writeFile: (p, d) => writeFile(p, d, 'utf8'),
        appendFile: (p, d) => appendFile(p, d, 'utf8'),
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        onAbort: (handler) => {
            const h = () => handler();
            process.once('SIGINT', h);
            process.once('SIGTERM', h);
            return () => {
                process.off('SIGINT', h);
                process.off('SIGTERM', h);
            };
        },
    };
}
