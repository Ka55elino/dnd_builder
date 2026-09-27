import './styles/fonts.css';
import './styles/variables.css';
import './styles/colors.css';
import './style.css';

import { mount } from 'svelte';
import App from './App.svelte';
import { Ready } from './api.js';
import { loadRefs } from './data/refs.js';

const boot = document.getElementById('boot');
const bootText = boot?.querySelector('.boot-text');
const say = (text) => bootText && (bootText.textContent = text);



/**
 * Startup: the loader from index.html stays up while the backend opens and
 * seeds the DB and the reference data loads; then the app is mounted
 * and the loader fades out.
 */
async function start() {
    try {
        say('Opening the database…');
        await Ready();
        say('Loading reference data…');
        await Promise.all([loadRefs(), document.fonts?.ready]);
    } catch (e) {
        boot?.classList.add('failed');
        say(`Could not start: ${e?.message ?? e}`);
        return;
    }
    mount(App, { target: document.getElementById('app') });
    requestAnimationFrame(() => {
        boot?.classList.add('hidden');
        setTimeout(() => boot?.remove(), 400);
    });
}

start();

