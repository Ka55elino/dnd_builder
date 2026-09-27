import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wails from '@wailsio/runtime/plugins/vite';

export default defineConfig({
    server: {
        // `wails3 dev` starts Vite on this port and points the app window at it
        host: '127.0.0.1',
        port: Number(process.env.WAILS_VITE_PORT) || 9245,
        strictPort: true,
    },
    plugins: [
        svelte(),
        wails('./bindings'), // serves the generated Go bindings (frontend/bindings) in dev mode
    ],
});
