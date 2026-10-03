const fail = (code, status) => Object.assign(new Error(code), {code, status});
export function createProjectTrashClient({getUser, fetchImpl = fetch, newId = () => crypto.randomUUID()}) {
    const pending = new Map();
    return async (kind, projectId) => {
        const user = getUser(); if (!user) throw fail('AUTH_REQUIRED');
        const current = () => {if (getUser() !== user || getUser()?.uid !== user.uid) throw fail('AUTH_CHANGED');};
        async function request(body) {
            current(); const token = await user.getIdToken(); current();
            const response = await fetchImpl('/api/project-trash', {method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
                signal: AbortSignal.timeout(15000), headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify(body)});
            const text = await response.text(); current(); if (text.length > 16384) throw fail('TRASH_UNAVAILABLE');
            let data; try {data = JSON.parse(text);} catch {throw fail('TRASH_UNAVAILABLE');}
            if (!response.ok) throw fail(/^[A-Z_]{1,80}$/.test(data?.error) ? data.error : 'TRASH_UNAVAILABLE', response.status);
            return data;
        }
        const key = `${user.uid}/${projectId}/${kind}`;
        let command = pending.get(key);
        if (!command) {
            const context = await request({kind: 'context', projectId}); current();
            command = {kind, projectId, requestId: newId(), baseRevision: context.revision, sourceVersion: context.sourceVersion};
            pending.set(key, command);
        }
        try {const result = await request(command); pending.delete(key); return result;}
        catch (e) {if ([400,401,403,404,409,413,415].includes(e.status)) pending.delete(key); throw e;}
    };
}
export function projectTrashError(error, en = false) {
    const code = error?.code || error?.message;
    if (code === 'TRASH_UNAVAILABLE') return en ? 'Moving manuscripts to Trash is currently unavailable. Your manuscript has been kept.' : '現在、原稿をゴミ箱へ移す操作は利用できません。原稿は保持されています。';
    if (code === 'PROJECT_CHANGED') return en ? 'This manuscript changed. Refresh the list and try again.' : '原稿が更新されています。一覧を更新してから再試行してください。';
    if (code === 'TRASH_RESTORE_EXPIRED') return en ? 'The 30-day recovery period has ended.' : '30日間の復元期限を過ぎています。';
    if (code === 'SHARED_AUTHORING_REQUIRED') return en ? 'Trash for collaborative manuscripts is not available yet.' : '共同編集中の原稿は、現在このゴミ箱操作に対応していません。';
    return en ? 'Could not complete this action. Check your connection and access, then retry.' : '操作できませんでした。接続とアクセス権を確認して再試行してください。';
}
