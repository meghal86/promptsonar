import { DetectedPrompt, ParserOptions } from './types';
export * from './types';
export declare function parseFile(options: ParserOptions): Promise<DetectedPrompt[]>;
