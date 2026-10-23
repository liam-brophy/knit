// The ONE place the app binds to the model + renderer modules (see ARCHITECTURE.md).
export * from '../model/doc.js';
export { composeChart, cellAtInches, cellCentre, paintKey, textMetrics, fontCss } from '../model/compose.js';
export { createKnitRenderer } from '../render/knit.js';
