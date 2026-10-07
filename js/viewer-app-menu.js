import {initializePlatformMenu} from './platform-menu.js';
export function initializeViewerAppMenu({beforeOpen,onClose}) {
    return initializePlatformMenu({surface:'viewer',triggers:[document.getElementById('viewer-app-menu-button')],beforeOpen,onClose,
        fileButton:document.getElementById('viewer-file-btn'),onFile:()=>document.getElementById('file-input').click()});
}
