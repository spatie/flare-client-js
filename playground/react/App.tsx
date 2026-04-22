import { AsyncErrorSection } from './sections/AsyncErrorSection';
import { ManualReportSection } from './sections/ManualReportSection';
import { OnClickErrorSection } from './sections/OnClickErrorSection';
import { RenderErrorSection } from './sections/RenderErrorSection';

export function App() {
    return (
        <>
            <RenderErrorSection />
            <OnClickErrorSection />
            <AsyncErrorSection />
            <ManualReportSection />
        </>
    );
}
