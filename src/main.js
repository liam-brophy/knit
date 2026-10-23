// Knit entry (bundled by build.mjs into dist/stitch-setter.html).
import { start } from './app/app.js';

const go = () => start().catch((e) => { console.error(e); const t = document.getElementById('toast'); if (t) { t.textContent = 'Knit failed to start: ' + (e && e.message); t.hidden = false; } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
