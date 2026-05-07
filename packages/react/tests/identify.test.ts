import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('registerReactSdkIdentity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('calls flare.setSdkInfo with name @flareapp/react', async () => {
        const mockSetSdkInfo = vi.fn();
        const mockSetFramework = vi.fn();

        vi.doMock('@flareapp/js', () => ({
            flare: {
                setSdkInfo: mockSetSdkInfo,
                setFramework: mockSetFramework,
            },
        }));

        const { registerReactSdkIdentity } = await import('../src/identify');
        registerReactSdkIdentity();

        expect(mockSetSdkInfo).toHaveBeenCalledOnce();
        expect(mockSetSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/react' }));
    });

    test('calls flare.setFramework with name React', async () => {
        const mockSetSdkInfo = vi.fn();
        const mockSetFramework = vi.fn();

        vi.doMock('@flareapp/js', () => ({
            flare: {
                setSdkInfo: mockSetSdkInfo,
                setFramework: mockSetFramework,
            },
        }));

        const { registerReactSdkIdentity } = await import('../src/identify');
        registerReactSdkIdentity();

        expect(mockSetFramework).toHaveBeenCalledOnce();
        expect(mockSetFramework).toHaveBeenCalledWith(expect.objectContaining({ name: 'React' }));
    });

    test('is idempotent: calling twice only registers once', async () => {
        const mockSetSdkInfo = vi.fn();
        const mockSetFramework = vi.fn();

        vi.doMock('@flareapp/js', () => ({
            flare: {
                setSdkInfo: mockSetSdkInfo,
                setFramework: mockSetFramework,
            },
        }));

        const { registerReactSdkIdentity } = await import('../src/identify');
        registerReactSdkIdentity();
        registerReactSdkIdentity();

        expect(mockSetSdkInfo).toHaveBeenCalledOnce();
        expect(mockSetFramework).toHaveBeenCalledOnce();
    });
});
