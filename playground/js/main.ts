import { createSidebar } from '../shared/createSidebar';
import { initFlare } from '../shared/initFlare';

import { renderCauseChainSection } from './sections/causeChainSection';
import { renderEnrichmentSection } from './sections/enrichmentSection';
import { renderHooksSection } from './sections/hooksSection';
import { renderManualReportingSection } from './sections/manualReportingSection';
import { renderPromiseRejectionSection } from './sections/promiseRejectionSection';
import { renderRapidFireSection } from './sections/rapidFireSection';
import { renderTimeoutErrorSection } from './sections/timeoutErrorSection';
import { renderTypeErrorSection } from './sections/typeErrorSection';

initFlare(import.meta.env.VITE_FLARE_JS_KEY);

createSidebar();

const root = document.querySelector<HTMLElement>('[data-slot="tests"]')!;

renderTimeoutErrorSection(root);
renderTypeErrorSection(root);
renderCauseChainSection(root);
renderPromiseRejectionSection(root);
renderManualReportingSection(root);
renderEnrichmentSection(root);
renderHooksSection(root);
renderRapidFireSection(root);
