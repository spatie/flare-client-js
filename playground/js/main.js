import { flare } from '@flareapp/js';

flare.light(import.meta.env.VITE_FLARE_KEY, true);

const status = document.getElementById('status');

function showStatus(message, isError = false) {
    status.textContent = message;
    status.className = isError ? 'error' : 'success';
    status.style.display = 'block';
}

document.getElementById('test-connection').addEventListener('click', async () => {
    try {
        await flare.test();
        showStatus('Test report sent successfully!');
    } catch (e) {
        showStatus(`Failed: ${e.message}`, true);
    }
});

document.getElementById('unhandled-error').addEventListener('click', () => {
    showStatus('Throwing unhandled error...');
    throw new Error('Unhandled JS playground error');
});

document.getElementById('manual-report').addEventListener('click', async () => {
    try {
        await flare.report(new Error('Manually reported error from JS playground'));
        showStatus('Manual report sent!');
    } catch (e) {
        showStatus(`Failed: ${e.message}`, true);
    }
});

document.getElementById('async-error').addEventListener('click', async () => {
    showStatus('Triggering async error...');
    await Promise.resolve();
    throw new Error('Async error from JS playground');
});

document.getElementById('custom-context').addEventListener('click', async () => {
    flare.addContext('playground', 'js');
    flare.addContext('testId', crypto.randomUUID());
    flare.addContextGroup('user', {
        name: 'Test User',
        email: 'test@example.com',
    });

    try {
        await flare.report(new Error('Error with custom context from JS playground'));
        showStatus('Report with custom context sent!');
    } catch (e) {
        showStatus(`Failed: ${e.message}`, true);
    }
});

document.getElementById('report-message').addEventListener('click', async () => {
    try {
        await flare.reportMessage('Test message from JS playground', {
            context: { source: 'playground-js' },
        });
        showStatus('Message report sent!');
    } catch (e) {
        showStatus(`Failed: ${e.message}`, true);
    }
});
