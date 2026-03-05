const fs = require('fs');
const path = require('path');

const mdContent = fs.readFileSync('/Users/meghalparikh/Downloads/PromptSonar_Test_Engineering_Prompt.md', 'utf8');

const regex = /\*\*File:\s*`([^`]+)`\*\*\s*```\w*\n([\s\S]*?)\n```/g;
let match;

while ((match = regex.exec(mdContent)) !== null) {
    let relativePath = match[1];
    let content = match[2];

    let fullPath;
    if (relativePath.startsWith('runner/') || relativePath.startsWith('golden/')) {
        fullPath = path.join('/Users/meghalparikh/Downloads/promptsonar/tests', relativePath);
    } else {
        fullPath = path.join('/Users/meghalparikh/Downloads/promptsonar/tests/validation', relativePath);
    }

    // Create directory if it doesn't exist
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Created: ${fullPath}`);
}
