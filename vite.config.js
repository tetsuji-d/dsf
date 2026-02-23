import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                index: resolve(__dirname, 'index.html'),
                studio: resolve(__dirname, 'studio.html'),
                viewer: resolve(__dirname, 'viewer.html'),
            },
        },
    },
});
