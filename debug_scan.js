const { parseFile, evaluatePrompt } = require('./packages/core/dist/index.js');
const fg = require('./packages/cli/node_modules/fast-glob');
const fs = require('fs');
const path = require('path');

async function testScan() {
    console.log("Finding files...");
    const rawFiles = fg.sync(['**/*.{ts,js,py,go,java,rs,cs,prompt,ai,chat}'], { absolute: true });

    const excludeKeywords = ['/node_modules/', '\\node_modules\\', '/dist/', '\\dist\\', '/out/', '\\out\\', '/build/', '\\build\\', '/vendor/', '\\vendor\\', '/.git/', '\\.git\\', '/venv/', '\\venv\\', '/tests/', '\\tests\\', '/test/', '\\test\\'];

    // Sort to ensure predictable ordering
    const files = rawFiles
        .filter(f => !excludeKeywords.some(kw => f.includes(kw)))
        .sort();

    console.log(`Found ${files.length} files to scan. Commencing loop...`);
    const config = { efficiency: { token_budget: 8192 } };

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Print immediately before so we see what hangs
        console.log(`[${i + 1}/${files.length}] Scanning ${path.basename(file)}...`);

        const stat = fs.statSync(file);
        if (stat.size > 500 * 1024) {
            console.log(`  -> Skipped (too large)`);
            continue;
        }

        const text = fs.readFileSync(file, 'utf8');

        let detectedPrompts = [];
        try {
            // Add a timeout promise to catch hangs
            const parsePromise = parseFile({
                filePath: file,
                content: text,
                language: ''
            });
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000));

            detectedPrompts = await Promise.race([parsePromise, timeoutPromise]);

        } catch (err) {
            console.log(`  -> Error parsing: ${err.message}`);
            continue;
        }

        for (const prompt of detectedPrompts) {
            try {
                const res = evaluatePrompt({ text: prompt.text, context: { filePath: file } }, config);
                if (res.findings.length > 0) {
                    console.log(`    -> Found ${res.findings.length} findings for prompt.`);
                }
            } catch (err) {
                console.log(`  -> Error evaluating prompt: ${err.message}`);
            }
        }
        if (detectedPrompts.length > 0) {
            console.log(`  -> Detected ${detectedPrompts.length} prompts.`);
        }
    }
    console.log("Scan complete!");
}

testScan().catch(err => console.error(err));
