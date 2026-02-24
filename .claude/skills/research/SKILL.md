---
name: research
description: Research a competitor's JavaScript error tracking SDK and compare its features against Flare's current capabilities.
disable-model-invocation: true
allowed-tools: Bash, Read, WebSearch, WebFetch
argument-hint: <competitor-name>
---

# Competitor Research: $ARGUMENTS

Research **$ARGUMENTS**'s JavaScript/frontend error tracking SDK and produce a structured comparison against Flare's current capabilities.

## Research areas

For each area, document what $ARGUMENTS offers and note whether Flare has it, partially has it, or is missing it:

1. **SDK setup & configuration** — initialization, config options, enabled/disabled toggle, sampling, filtering
2. **Error capture** — how errors are caught (global listeners, framework integrations), error cause chaining, non-Error handling
3. **Context collection** — what browser/device/user context is automatically collected
4. **Breadcrumbs** — what automatic breadcrumbs are captured (console, clicks, navigation, network, etc.)
5. **User identification** — setUser API, custom tags/metadata
6. **Sourcemaps** — which build tools are supported, upload workflow
7. **Framework integrations** — React, Vue, Svelte, Angular, etc. What framework-specific context is captured?
8. **Networking & reliability** — retry logic, offline queuing, rate limiting, batching, sendBeacon
9. **Unique/differentiating features** — anything they have that's novel or best-in-class
10. **Bundle size** — SDK size in KB (gzipped)
11. **DX & docs quality** — developer experience, documentation clarity

## Output format

Produce a markdown summary with:

1. A quick overview paragraph
2. A comparison table (Feature | $ARGUMENTS | Flare | Gap?)
3. Key takeaways: what should Flare prioritize based on this research?
4. Any ideas for features Flare could do better than $ARGUMENTS

## Reference

Before starting, read the `CLAUDE.md` in the repo root to understand Flare's current capabilities and existing research findings. Avoid duplicating what's already documented there — focus on new or deeper findings.
