import type { CanonicalIssueContext, CapabilityType, ArtifactKind } from './types';

export interface IntentInferenceInput {
    artifactKind: ArtifactKind;
    capability?: CapabilityType;
    declaredExpectedCapabilities?: CapabilityType[];
    evidenceIds?: string[];
}

const ROLE_EXPECTED_CAPABILITIES: Record<ArtifactKind, ReadonlySet<CapabilityType>> = {
    prompt: new Set<CapabilityType>(),
    agent: new Set<CapabilityType>(['shell', 'filesystem.read', 'filesystem.write', 'network', 'secret.read', 'external_api', 'privileged_tool']),
    skill: new Set<CapabilityType>(['shell', 'filesystem.read', 'filesystem.write', 'network', 'secret.read', 'external_api', 'deployment']),
    mcp_server: new Set<CapabilityType>(['filesystem.read', 'filesystem.write', 'network', 'external_api', 'secret.read', 'privileged_tool']),
    mcp_config: new Set<CapabilityType>(['filesystem.read', 'filesystem.write', 'network', 'external_api', 'secret.read', 'privileged_tool']),
    workflow: new Set<CapabilityType>(['deployment', 'secret.read', 'external_api', 'filesystem.read', 'filesystem.write']),
    memory: new Set<CapabilityType>(['filesystem.read', 'filesystem.write']),
    tool: new Set<CapabilityType>(['shell', 'filesystem.read', 'filesystem.write', 'network', 'external_api', 'database.read', 'database.write']),
    tool_router: new Set<CapabilityType>(['shell', 'filesystem.read', 'filesystem.write', 'network', 'external_api', 'privileged_tool']),
    documentation: new Set<CapabilityType>(),
    test: new Set<CapabilityType>(),
    fixture: new Set<CapabilityType>(),
    example: new Set<CapabilityType>(),
    source: new Set<CapabilityType>(),
    unknown: new Set<CapabilityType>(),
};

export function inferCapabilityIntent(input: IntentInferenceInput): CanonicalIssueContext['intentAssessment'] {
    const evidenceIds = input.evidenceIds || [];
    const declaredExpectedCapabilities = Array.isArray(input.declaredExpectedCapabilities)
        ? input.declaredExpectedCapabilities
        : [];
    if (input.capability && declaredExpectedCapabilities.includes(input.capability)) {
        return {
            expected: true,
            source: 'config',
            confidence: 'confirmed',
            evidenceIds,
        };
    }

    if (input.capability && ROLE_EXPECTED_CAPABILITIES[input.artifactKind]?.has(input.capability)) {
        return {
            expected: true,
            reason: `${input.capability} is commonly expected for ${input.artifactKind} artifacts; verify controls before treating it as safe.`,
            source: 'inferred',
            confidence: 'probable',
            evidenceIds,
        };
    }

    if (input.artifactKind === 'documentation' || input.artifactKind === 'test' || input.artifactKind === 'fixture' || input.artifactKind === 'example') {
        return {
            expected: 'unknown',
            reason: `${input.artifactKind} artifacts describe behavior but do not prove production execution.`,
            source: 'inferred',
            confidence: 'potential',
            evidenceIds,
        };
    }

    return {
        expected: 'unknown',
        source: 'unknown',
        confidence: 'potential',
        evidenceIds,
    };
}
