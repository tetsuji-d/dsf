/** Refresh authentication guidance without inventing successful persistence. */
export function syncAuthSaveStatus(element, {uid = '', en = false} = {}) {
    if (!element) return;
    uid = String(uid || '');
    const previous = element.dataset.authUid;
    element.dataset.authUid = uid;
    const staleGuest = ['ログインでクラウド保存', 'Sign in to save to cloud'].includes(element.textContent.trim());
    const changed = previous !== undefined && previous !== uid;
    if (!changed && !staleGuest && !element.dataset.authNotice && element.textContent.trim()) return;
    element.dataset.authNotice = 'true';
    element.dataset.saveStatus = 'idle';
    element.dataset.saveTarget = '';
    element.textContent = uid
        ? (en ? 'Signed in · Save to confirm cloud storage' : 'ログイン済み · 保存してクラウド保存を確認')
        : (en ? 'Sign in to save to cloud' : 'ログインでクラウド保存');
    element.style.color = '#8a5d00';
}
