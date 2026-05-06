import { flare } from '@flareapp/js';
import { useState } from 'react';

function BrokenComponent() {
    throw new Error('React component render error from playground');
}

export default function App() {
    const [status, setStatus] = useState(null);
    const [showBroken, setShowBroken] = useState(false);

    function showSuccess(msg) {
        setStatus({ message: msg, error: false });
    }

    function showError(msg) {
        setStatus({ message: msg, error: true });
    }

    async function testConnection() {
        try {
            await flare.test();
            showSuccess('Test report sent successfully!');
        } catch (e) {
            showError(`Failed: ${e.message}`);
        }
    }

    async function manualReport() {
        try {
            await flare.report(new Error('Manually reported error from React playground'));
            showSuccess('Manual report sent!');
        } catch (e) {
            showError(`Failed: ${e.message}`);
        }
    }

    async function customContext() {
        flare.addContext('playground', 'react');
        flare.addContext('testId', crypto.randomUUID());
        flare.addContextGroup('user', {
            name: 'Test User',
            email: 'test@example.com',
        });

        try {
            await flare.report(new Error('Error with custom context from React playground'));
            showSuccess('Report with custom context sent!');
        } catch (e) {
            showError(`Failed: ${e.message}`);
        }
    }

    async function reportMessage() {
        try {
            await flare.reportMessage('Test message from React playground', {
                context: { source: 'playground-react' },
            });
            showSuccess('Message report sent!');
        } catch (e) {
            showError(`Failed: ${e.message}`);
        }
    }

    return (
        <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 600, margin: '40px auto', padding: '0 20px' }}>
            <h1>Flare React Playground</h1>
            <p>
                Test error reporting for <code>@flareapp/react</code> with <code>FlareErrorBoundary</code>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button style={buttonStyle} onClick={testConnection}>
                    Test Connection
                </button>
                <button style={buttonStyle} onClick={() => setShowBroken(true)}>
                    Trigger Component Render Error (ErrorBoundary)
                </button>
                <button style={buttonStyle} onClick={manualReport}>
                    Manual Error Report
                </button>
                <button style={buttonStyle} onClick={customContext}>
                    Error with Custom Context
                </button>
                <button style={buttonStyle} onClick={reportMessage}>
                    Report Message (non-error)
                </button>
            </div>

            {showBroken && <BrokenComponent />}

            {status && (
                <div
                    style={{
                        marginTop: 20,
                        padding: 12,
                        borderRadius: 6,
                        background: status.error ? '#f8d7da' : '#d4edda',
                        color: status.error ? '#721c24' : '#155724',
                    }}
                >
                    {status.message}
                </div>
            )}
        </div>
    );
}

const buttonStyle = {
    padding: 12,
    fontSize: 16,
    cursor: 'pointer',
    border: '1px solid #ccc',
    borderRadius: 6,
    background: '#f5f5f5',
};
