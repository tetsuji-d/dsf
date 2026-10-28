import { defineConfig } from 'vite';
import {studioPwaPlugin} from './scripts/studio-pwa-plugin.js';
import { resolve } from 'path';
import {viewerBookSamplesPlugin} from './scripts/viewer-book-samples-plugin.js';
import {writingStagingPlugin} from './scripts/writing-w1/staging-assets.mjs';
import {writingBuildEnabled} from './scripts/writing-build-policy.mjs';

export default defineConfig(({ mode }) => {
    const input = {
        index: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
        mypage: resolve(__dirname, 'mypage.html'),
        studio: resolve(__dirname, 'studio.html'),
        viewer: resolve(__dirname, 'viewer.html'),
    };
    if (mode !== 'production') input.flowPreview = resolve(__dirname, 'flow-preview.html');

    return {
        // Studio holds unsaved authoring state. Apply development changes only
        // on manual reload; opt into HMR for disposable development sessions.
        server: { hmr: process.env.DSF_DEV_HMR === '1' },
        plugins: [viewerBookSamplesPlugin(mode),writingStagingPlugin(mode),studioPwaPlugin()].filter(Boolean),
        build: {
            rollupOptions: { input },
        },
        // VITE_ENV をクライアントコードで参照可能にする
        define: {
            __APP_ENV__: JSON.stringify(mode),
            __WRITING_ENABLED__: JSON.stringify(writingBuildEnabled(mode)),
        },
    };
});
