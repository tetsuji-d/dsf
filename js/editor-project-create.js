// New-project boundary shared by Studio and the synthetic acceptance fixture.
// Backup must complete before commit. No published data or global browser API here.
export async function createProjectWithBackup(draft, guard, { readProject, flushPendingSave, backup, commit }) {
    const signature = () => {
        const s = readProject();
        return JSON.stringify({blocks:s.blocks,meta:s.meta,title:s.title,projectName:s.projectName,
            languages:s.languages,defaultLang:s.defaultLang,activeLang:s.activeLang,languageConfigs:s.languageConfigs,projectAssets:s.projectAssets});
    };
    if (!guard()) return {error:{code:'TARGET_CHANGED'}};
    const before = signature();
    await flushPendingSave();
    if (!guard() || before !== signature()) return {error:{code:'TARGET_CHANGED'}};
    const snapshot = JSON.stringify(readProject());
    await backup(JSON.parse(snapshot));
    if (!guard() || snapshot !== JSON.stringify(readProject())) return {error:{code:'TARGET_CHANGED'}};
    commit(draft);
    return {created:true};
}
