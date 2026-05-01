import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
    build: {
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'index.html'),
                admin: resolve(__dirname, 'admin/index.html'),
                studio: resolve(__dirname, 'studio.html'),
                viewer: resolve(__dirname, 'viewer.html'),
            },
        },
    },
    // VITE_ENV をクライアントコードで参照可能にする
    define: {
        __APP_ENV__: JSON.stringify(mode),
    },
}));
