import { flare } from '../../shared/initFlare';
import { Button } from '../components/Button';
import { TestSection } from '../components/TestSection';

export function ManualReportSection() {
    return (
        <TestSection
            title="Manual flare.report()"
            description="Calls flare.report() directly with a synthetic error. No throw, no listener involvement."
        >
            <Button
                onClick={() => {
                    console.log('Calling flare.report() from React component');
                    flare.report(new Error('Manually reported from React'));
                }}
            >
                flare.report() from component
            </Button>
        </TestSection>
    );
}
