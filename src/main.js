// @ts-check
/** Vstup Vite aplikace — hot-seat UI nad enginem (fáze 2). */
import './ui/style.css';
import { initApp } from './ui/app.js';

initApp(/** @type {HTMLElement} */ (document.querySelector('#app')));
