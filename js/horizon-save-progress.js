/** Confirmed upload bytes; fetch does not report intra-file transfer progress. */
export function calculateHorizonSaveProgress({ completedBytes = 0, totalBytes = 0, elapsedMs = 0 } = {}) {
    const total = Math.max(0, Number(totalBytes) || 0);
    const done = Math.min(total, Math.max(0, Number(completedBytes) || 0));
    const percent = total > 0 ? Math.min(99, Math.floor(done / total * 100)) : 0;
    const remainingSeconds = done > 0 && done < total && elapsedMs >= 1000
        ? Math.max(5, Math.ceil(((total - done) / done * elapsedMs / 1000) / 5) * 5) : null;
    return { percent, remainingSeconds };
}

export function isManualHorizonSaveCancellation(error, requested) {
    return requested === true && (error?.name === 'AbortError'
        || error?.code === 'HORIZON_UPLOAD_ABORTED'
        || error?.issues?.some(issue => issue?.code === 'HORIZON_UPLOAD_ABORTED') === true);
}
