import { flare, FlareErrorBoundary } from '@flareapp/react-native';
import { flareSourcemapVersion } from '@flareapp/react-native-sourcemaps/runtime';
import React, { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { config, isConfigured } from './flare.config';

// Boot once at module load. Skipped until a real key is set.
if (isConfigured) {
    flare.configure({
        ingestUrl: config.ingestUrl,
        stage: 'smoke',
        // The babel plugin (@flareapp/react-native-sourcemaps/babel) replaces
        // flareSourcemapVersion with the build's FLARE_SOURCEMAP_VERSION literal, so
        // reports carry a sourcemapVersionId the backend matches against the upload.
        sourcemapVersionId: flareSourcemapVersion,
    });
    flare.light(config.key);
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable style={styles.btn} onPress={onPress} accessibilityRole="button">
            <Text style={styles.btnText}>{label}</Text>
        </Pressable>
    );
}

// Throws during render when armed — drives the FlareErrorBoundary scenario.
function RenderBomb({ armed }: { armed: boolean }) {
    if (armed) throw new Error('Flare smoke: React render error');
    return null;
}

export default function App() {
    const [status, setStatus] = useState('Ready');
    const [armed, setArmed] = useState(false);

    if (!isConfigured) {
        return (
            <SafeAreaView style={styles.screen}>
                <Text style={styles.title}>Flare RN smoke test</Text>
                <Text style={styles.warn}>Set your project key in flare.config.ts, then reload.</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.screen}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.title}>Flare RN smoke test</Text>
                <Text style={styles.status}>{status}</Text>

                <Btn
                    label="1. Sync throw (uncaught)"
                    onPress={() => {
                        setStatus('sync throw fired');
                        throw new Error('Flare smoke: sync throw');
                    }}
                />
                <Btn
                    label="2. Fatal error (release build to observe)"
                    onPress={() => {
                        setStatus('fatal fired — flush-before-crash only in a Release build');
                        (
                            global as { ErrorUtils?: { reportFatalError?: (e: Error) => void } }
                        ).ErrorUtils?.reportFatalError?.(new Error('Flare smoke: fatal'));
                    }}
                />
                <Btn
                    label="3. Unhandled rejection (Error)"
                    onPress={() => {
                        setStatus('rejected with Error');
                        Promise.reject(new Error('Flare smoke: rejected Error'));
                    }}
                />
                <Btn
                    label="4. Unhandled rejection (string)"
                    onPress={() => {
                        setStatus('rejected with string');
                        // Intentionally a non-Error reason — exercises the stackless rejection route.
                        Promise.reject('Flare smoke: rejected string');
                    }}
                />

                <FlareErrorBoundary
                    fallback={({ resetErrorBoundary }) => (
                        <View style={styles.fallback}>
                            <Text style={styles.warn}>Boundary caught a render error</Text>
                            <Btn
                                label="Reset boundary"
                                onPress={() => {
                                    setArmed(false);
                                    resetErrorBoundary();
                                }}
                            />
                        </View>
                    )}
                >
                    <RenderBomb armed={armed} />
                    <Btn label="5. React render error" onPress={() => setArmed(true)} />
                </FlareErrorBoundary>

                <Btn
                    label="6. Manual report"
                    onPress={() => {
                        flare.report(new Error('Flare smoke: manual report'));
                        setStatus('manual report sent');
                    }}
                />
                <Btn
                    label="7. Glow then report"
                    onPress={() => {
                        flare.glow('checkout-step', 'info', { cart: 3 });
                        flare.report(new Error('Flare smoke: report with glow'));
                        setStatus('glow + report sent');
                    }}
                />
                <Btn
                    label="8. setUser then report"
                    onPress={() => {
                        flare.setUser({ id: 42, email: 'smoke@flareapp.io', fullName: 'Smoke Test' });
                        flare.report(new Error('Flare smoke: report with user'));
                        setStatus('user set + report sent');
                    }}
                />
                <Btn
                    label="9. Context marker report"
                    onPress={() => {
                        flare.report(new Error('Flare smoke: CONTEXT MARKER'));
                        setStatus('context marker sent — verify os.*, device.screen.* (and device.model.name on Expo)');
                    }}
                />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#0b0b0f' },
    content: { padding: 16, gap: 10 },
    title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4 },
    status: { color: '#9ca3af', marginBottom: 8 },
    warn: { color: '#fbbf24', marginTop: 8 },
    fallback: { gap: 8, padding: 12, borderRadius: 8, backgroundColor: '#1f2937' },
    btn: { backgroundColor: '#6366f1', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8 },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
