/**
 * The PromptSonar release version. core and cli are released together at the
 * same version, so this is the single source for every version string the
 * engine and CLI print (reports, SARIF, --version). The release-hygiene check
 * fails CI if any package.json or this constant disagree.
 */
export const PROMPTSONAR_VERSION = '1.6.0';
