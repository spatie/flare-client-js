import { AsyncErrorSection } from './sections/AsyncErrorSection';
import { ManualReportSection } from './sections/ManualReportSection';
import { OnClickErrorSection } from './sections/OnClickErrorSection';
import { RenderErrorSection } from './sections/RenderErrorSection';
import { ResetKeysSection } from './sections/ResetKeysSection';

export function App() {
    return (
        <>
            <RenderErrorSection />
            <ResetKeysSection />
            <OnClickErrorSection />
            <AsyncErrorSection />
            <ManualReportSection />
        </>
    );
}
