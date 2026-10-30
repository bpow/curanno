import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { useAuthStore } from './auth/store';
import './style.css';

const pinia = createPinia();
// The session is restored (and a sign-in redirect completed, which rewrites
// the URL) before anything reads the location.
await useAuthStore(pinia).init();
createApp(App).use(pinia).mount('#app');
