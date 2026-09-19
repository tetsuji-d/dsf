import { preparePrivateProjectAction, runPrivateProjectAction } from '../../js/private-project-actions.js';
// Local-only harness for the real Studio save/load module. No cloud credentials.
import { state, dispatch, actionTypes } from '../../js/state.js';
import { auth } from '../../js/firebase-core.js';
import { loadProject, flushSave, triggerAutoSave, restorePreviousCloudAuthoring } from '../../js/firebase.js';
import { get } from 'idb-keyval';
const $ = id => document.getElementById(id);
dispatch({ type: actionTypes.SET_AUTH_STATE, payload: { uid: auth.currentUser.uid, user: auth.currentUser } });
function paragraph() { return state.blocks[0].flow.document.sections[0].blocks[0]; }
async function stats() {
    const data = await (await fetch('/fixture/status')).json();
    const backup = await get('dsf_autosave');
    $('evidence').textContent = JSON.stringify({ ...data, localCharacters: backup?.state.blocks?.[0]?.flow?.document?.sections[0]?.blocks[0]?.texts?.ja?.length ?? 0 }, null, 2);
}
$('load').onclick = async () => {
    try { await loadProject('project_1', () => { $('text').value = paragraph().texts.ja; }); $('result').textContent = 'クラウド版を読み込みました'; }
    catch (e) { $('result').textContent = e.code || e.message; }
    await stats();
};
$('text').oninput = () => { paragraph().texts.ja = $('text').value; triggerAutoSave(); };
$('large').onclick = () => {
    const texts = paragraph().texts; for (const lang of ['ja', 'en', 'ko', 'zh']) texts[lang] = (lang === 'en' ? 'A' : '文').repeat(100_000);
    state.languages = ['ja', 'en', 'ko', 'zh']; $('text').value = texts.ja; triggerAutoSave();
};
$('save').onclick = async () => { try { await flushSave(); $('result').textContent = '保存処理完了'; } catch (e) { $('result').textContent = `保存未完了: ${e.code || e.message}`; } await stats(); };
for (const id of ['lost', 'conflict', 'normal', 'delay']) $(id).onclick = async () => { await fetch(`/fixture/mode/${id}`, { method: 'POST' }); $('result').textContent = `検証条件: ${id}`; };
$('switch').onclick = () => { dispatch({ type: actionTypes.LOAD_PROJECT, payload: { projectId: 'other_project', version: 6, blocks: [], sections: [], pages: [] } }); $('save-status').textContent = '別プロジェクト'; $('result').textContent = '画面切替済み'; };
$('local').onclick = async () => { const backup = await get('dsf_autosave'); dispatch({ type: actionTypes.LOAD_PROJECT, payload: backup.state }); $('text').value = paragraph().texts.ja; $('result').textContent = 'ローカル復元済み'; };
$('stats').onclick = stats;

$('restore').onclick = async () => { try { await restorePreviousCloudAuthoring(() => { $('text').value = paragraph().texts.ja; }); $('result').textContent = '前の原稿を新しい版として復元しました'; } catch (e) { $('result').textContent = e.code || e.message; } await stats(); };
$('delete').onclick = async () => { try { const c = await preparePrivateProjectAction('project_1'); await runPrivateProjectAction(c, 'delete'); $('result').textContent = '削除しました'; } catch(e) { $('result').textContent = e.code || e.message; } await stats(); };
