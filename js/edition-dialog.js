/** An in-page confirmation keeps focus and cancellation inside Reads. */
export function confirmEditionAction(message, locale = 'ja') {
    return new Promise(resolve => {
        const previous = document.activeElement;
        const en = locale === 'en', dialog = document.createElement('dialog');
        dialog.className = 'edition-confirm-dialog';
        dialog.setAttribute('aria-labelledby', 'edition-confirm-heading');
        const heading = document.createElement('h2'); heading.id = 'edition-confirm-heading';
        heading.textContent = en ? 'Confirm edition change' : 'リードの変更を確認';
        const body = document.createElement('p'); body.textContent = message;
        const actions = document.createElement('div');
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = en ? 'Cancel' : 'キャンセル';
        const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = en ? 'Confirm change' : '変更する';
        let accepted = false;
        accept.addEventListener('click', () => { accepted = true; dialog.close(); });
        cancel.addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => { dialog.remove(); previous?.focus(); resolve(accepted); }, {once:true});
        actions.append(cancel, accept); dialog.append(heading, body, actions);
        document.body.append(dialog); dialog.showModal(); cancel.focus();
    });
}
