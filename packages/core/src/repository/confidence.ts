import type { RepositoryPathConfidence } from './types';

export const REPOSITORY_CONFIDENCE_DEFINITIONS: Record<RepositoryPathConfidence, string> = {
    confirmed: 'Direct evidence exists.',
    probable: 'Evidence inferred from connected relationships.',
    potential: 'Structural inference only.',
};

export function repositoryConfidenceDefinition(level: RepositoryPathConfidence): string {
    return REPOSITORY_CONFIDENCE_DEFINITIONS[level];
}
