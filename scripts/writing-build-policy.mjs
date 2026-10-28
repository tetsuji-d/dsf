// Staging must retain the already released Reader/Writing file support.
// Missing reviewed assets should fail the build, not silently remove support.
export function writingBuildEnabled(mode, env = process.env) {
    if (mode === 'staging') return true;
    return mode === 'production'
        ? env.DSF_WRITING_RELEASE === '1'
        : env.DSF_WRITING_PREVIEW === '1';
}
