import type { Attributes, AttributeValue, EntryPointHandler, Glow } from './types';

export class Scope {
    glows: Glow[] = [];
    pendingAttributes: Attributes = {};
    entryPoint: EntryPointHandler | null = null;

    addGlow(glow: Glow, maxGlowsPerReport: number): void {
        this.glows.push(glow);
        if (this.glows.length > maxGlowsPerReport) {
            this.glows = this.glows.slice(this.glows.length - maxGlowsPerReport);
        }
    }

    clearGlows(): void {
        this.glows = [];
    }

    setAttribute(key: string, value: AttributeValue): void {
        this.pendingAttributes[key] = value;
    }

    mergeAttributes(partial: Attributes): void {
        Object.assign(this.pendingAttributes, partial);
    }
}

export interface ScopeProvider {
    active(): Scope;
}

export class GlobalScopeProvider implements ScopeProvider {
    private scope = new Scope();
    active(): Scope {
        return this.scope;
    }
}
