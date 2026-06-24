import type { VerdictInput } from './types';

export interface RawFindingLike {
    severity?: string;
    workflow?: {
        path?: {
            privilegedSinkReached?: boolean;
        };
    };
}

export type RawFindingAdapter<T> = (raw: T) => VerdictInput;

export function fallbackVerdictInputForRawFinding(raw: RawFindingLike): VerdictInput {
    const privilegedSinkReached = Boolean(raw.workflow?.path?.privilegedSinkReached);
    const severity = String(raw.severity || '').toLowerCase();
    return {
        capabilityPrivilege: privilegedSinkReached
            ? 'privileged'
            : severity === 'high' || severity === 'critical'
                ? 'sensitive'
                : 'ordinary',
        exposure: 'unknown',
        reachability: privilegedSinkReached ? 'probable' : 'not_verified',
        controlState: 'unavailable',
        contextAvailability: 'partial',
        intent: 'unknown',
        directVulnerability: { present: false },
    };
}

export const fallbackVerdictInputForMcpFinding = fallbackVerdictInputForRawFinding;
export const fallbackVerdictInputForWorkflowEvidence = fallbackVerdictInputForRawFinding;
