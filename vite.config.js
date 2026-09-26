import { defineConfig } from 'vite';
import { resolve } from 'path';
import {viewerBookSamplesPlugin} from './scripts/viewer-book-samples-plugin.js';

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
        plugins: [viewerBookSamplesPlugin(mode)].filter(Boolean),
        build: {
            rollupOptions: { input },
        },
        // VITE_ENV をクライアントコードで参照可能にする
        define: {
            __APP_ENV__: JSON.stringify(mode),
        },
    };
});
