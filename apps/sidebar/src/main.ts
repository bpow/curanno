import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { useAuthStore } from './auth/store';
import { loadConfig } from './config';
import './style.css';

// The deployment's configuration first, then the session is restored (and a
// sign-in redirect completed, which rewrites the URL) before anything reads
// the location.
await loadConfig();
const pinia = createPinia();
await useAuthStore(pinia).init();
createApp(App).use(pinia).mount('#app');
