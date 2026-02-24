import { parseFile } from './src/parser/index';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
  const targetFile = '../../tests/sample-repos/langchain-example.py';
  const content = fs.readFileSync(path.resolve(__dirname, targetFile), 'utf8');

  const results = await parseFile({
    filePath: path.resolve(__dirname, targetFile),
    content,
    language: 'python'
  });
  console.log(JSON.stringify(results, null, 2));
}
run();
