/** Bound SDK reads which do not accept AbortSignal, ignoring their late result. */
export function withEditionDeadline(task, { timeoutMs = 15_000, signal } = {}) {
    return new Promise((resolve, reject) => {
        let timer;
        const finish = (callback, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); };
        const abort = () => finish(reject, signal.reason || new Error('EDITION_LIST_CHANGED'));
        // Observe the task even when already cancelled, so a late rejection is consumed.
        Promise.resolve(task).then(value => finish(resolve, value), error => finish(reject, error));
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => finish(reject, new Error('EDITION_LOAD_TIMEOUT')), timeoutMs);
    });
}
