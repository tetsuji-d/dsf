import { choosePublishingSpace } from './publishing-space-publish-dialog.js';
import { requestPublishingSpaces } from './publishing-spaces-client.js';
import { auth } from './firebase-core.js';
import { getUILang } from './i18n-studio.js';
import '../css/publishing-space-publish-dialog.css';
let pending = false;
export async function ensurePublishingSpace({projectId, purpose = 'draft', isCurrent = () => true}) {
    if (import.meta.env.VITE_PUBLISHING_SPACES_REQUIRED !== 'true') return true;
    if (pending) return false;
    const user = auth.currentUser;
    if (!user || !projectId) { alert(getUILang() === 'en' ? 'Sign in and save this manuscript to the cloud first.' : 'ログインして、先に原稿をクラウドへ保存してください。'); return false; }
    pending = true;
    try { return await choosePublishingSpace({request:requestPublishingSpaces, projectId, purpose, getLocale:getUILang,
        isCurrent:() => auth.currentUser === user && isCurrent()}); }
    finally { pending = false; }
}
