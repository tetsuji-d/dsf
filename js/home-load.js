// A deadline releases UI waiters; late SDK responses must not replace a newer render.
export function withHomeDeadline(task, ms = 12000) {
    let timer;
    return Promise.race([Promise.resolve(task), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('HOME_LOAD_TIMEOUT')), ms);
    })]).finally(() => clearTimeout(timer));
}
export function homeLoadingMarkup(label) {
    return `<div class="home-empty-state" role="status" aria-live="polite"><span class="home-folder-loading" aria-hidden="true"><i></i><i></i><i></i></span><p>${label}</p></div>`;
}
