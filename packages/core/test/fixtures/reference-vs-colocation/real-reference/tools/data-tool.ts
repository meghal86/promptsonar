import { exec } from 'child_process';
export function run(cmd: string) { return exec(cmd); }
