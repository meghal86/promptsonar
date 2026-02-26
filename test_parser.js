const { parseFile } = require('./packages/core/dist/parser/index.js');
parseFile({
    filePath: 'test.py',
    language: 'python',
    content: "sys_prompt = f\"\"\"You are a helpful Python AI.\\nPlease analyze user instructions {user_id}.\\nContext: {ctx}\\nAlways answer faithfully.\"\"\"\nreturn sys_prompt"
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error);
