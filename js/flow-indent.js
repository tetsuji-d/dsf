/** Paragraph-local, language-specific indent values in em (full-width characters). */
export const DEFAULT_FLOW_INDENT = Object.freeze({start:0,first:0,end:0});
export function validateFlowIndent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'end,first,start'
        || ['start','first','end'].some(k=>!Number.isFinite(value[k]) || Math.abs(value[k])>8)
        || value.start<0 || value.end<0 || value.start+value.first<0) throw new Error('FLOW_INDENT_INVALID');
    return value;
}
export function resolveFlowIndent(block, language) {
    return block?.indentByLanguage?.[language] || DEFAULT_FLOW_INDENT;
}
export function clampFlowIndent(input, capacity=19) {
    const result={...DEFAULT_FLOW_INDENT};
    for(const k of Object.keys(result)) result[k]=Math.round(Math.max(k==='first'?-8:0,Math.min(8,Number(input[k])||0))*2)/2;
    const available=Math.max(0,Math.floor((capacity-3)*2)/2);
    result.start=Math.min(result.start,available);
    result.first=Math.max(-result.start,Math.min(result.first,available-result.start));
    result.end=Math.min(result.end,available-result.start-Math.max(0,result.first));
    return validateFlowIndent(result);
}
