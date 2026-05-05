import { Button } from '../components/Button';
import { TestSection } from '../components/TestSection';

export function OnClickErrorSection() {
    return (
        <TestSection
            title="Uncaught error in an event handler"
            description="Throws synchronously inside onClick. React does not catch event-handler errors, so this is handled by the global window.onerror listener."
        >
            <Button
                onClick={() => {
                    console.log('Throwing error in onClick handler');
                    throw new Error('Error in React onClick handler');
                }}
            >
                Throw in onClick
            </Button>
        </TestSection>
    );
}
