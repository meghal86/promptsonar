const fs = require('fs');
const { parseFile } = require('./packages/core/dist/parser');

async function test() {
    const file = 'tests/validation/security/should_not_flag/fp_imports_and_boilerplate.ts';
    const content = fs.readFileSync(file, 'utf8');
    const prompts = await parseFile({ filePath: file, content, language: 'typescript' });
    console.log(JSON.stringify(prompts, null, 2));
}

test().catch(console.error);
