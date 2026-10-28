export function createViewGate({ now = performance.now.bind(performance), qualify }) {
    let since = null, completed = false;
    return {
        sample(visible, ready) {
            if (!visible || !ready) { since = null; return; }
            if (completed) return;
            since ??= now();
            if (now() - since >= 5000) { completed = true; qualify('visible'); }
        },
        navigate({ visible, ready, trusted, changed }) {
            if (!completed && visible && ready && trusted && changed) { completed = true; qualify('navigation'); }
        },
        retry() { completed = false; since = null; },
    };
}

export function startReaderViewSession({ editionId, source, element, ready = () => true }) {
    let active = true, ratio = 0, ticket = null, trustedAt = -Infinity, lastPage = null, attempts = 0, pendingNavigation = false;
    let sessionId;
    try { sessionId = sessionStorage.getItem('dsf-reader-session-v2'); } catch { /* third-party storage may be denied */ }
    if (!/^[a-zA-Z0-9_-]{24,80}$/.test(sessionId || '')) {
        sessionId = crypto.randomUUID();
        try { sessionStorage.setItem('dsf-reader-session-v2',sessionId); } catch { /* memory-only fallback */ }
    }
    const request = async body => {
        const response = await fetch('/api/reader-metrics',{method:'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000),
            headers:{'Content-Type':'application/json'},body:JSON.stringify({editionId,sessionId,source,...body})});
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status});
        return result;
    };
    const visible = () => !document.hidden && ratio >= .5;
    const readyNow = () => active && !!ticket && ready();
    const gate = createViewGate({qualify:reason => void send(reason)});
    async function acquire() {
        try { const result = await request({action:'ticket'}); if (active) ticket = result; }
        catch { if(active) element.dataset.viewStatus='unavailable'; }
    }
    async function send(reason) {
        if (!ticket || !active) return;
        try {
            const result = await request({action:'qualify',ticket:ticket.ticket,window:ticket.window,reason});
            if (active) element.dataset.viewStatus = result.duplicate ? 'duplicate' : 'counted';
        } catch (error) {
            if (active && ++attempts < 3 && ![403,404,429].includes(error.status)) {
                if(error.status===410) await acquire();
                gate.retry();
            } else if(active) element.dataset.viewStatus='unavailable';
        }
    }
    const observer = new IntersectionObserver(entries => { ratio = entries[0]?.intersectionRatio || 0; if (!visible()) gate.sample(false,false); },{threshold:[0,.5,1]});
    observer.observe(element);
    const intent = event => { if(event.isTrusted) trustedAt=performance.now(); };
    document.addEventListener('pointerdown',intent,true); document.addEventListener('keydown',intent,true);
    const visibility = () => gate.sample(false,false);
    document.addEventListener('visibilitychange',visibility);
    const timer = setInterval(() => {
        if(ticket && Date.now() >= ticket.expiresAtMs) { ticket=null; gate.retry(); void acquire(); }
        if (!visible()) pendingNavigation = false;
        if (pendingNavigation && readyNow()) { pendingNavigation=false; gate.navigate({visible:visible(),ready:true,trusted:true,changed:true}); }
        gate.sample(visible(),readyNow());
    },250);
    void acquire();
    return {
        page(key, reason) {
            const changed = lastPage !== null && key !== lastPage; lastPage=key;
            const navigation = ['navigation','jump','book_navigation','page_link','spread_pan'].includes(reason);
            pendingNavigation = navigation && changed && visible() && performance.now()-trustedAt < 2500;
            gate.navigate({visible:visible(),ready:readyNow(),trusted:navigation && performance.now()-trustedAt < 2500,changed});
        },
        dispose() { active=false; clearInterval(timer); observer.disconnect(); document.removeEventListener('pointerdown',intent,true); document.removeEventListener('keydown',intent,true); document.removeEventListener('visibilitychange',visibility); },
    };
}
