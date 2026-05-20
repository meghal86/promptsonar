import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { evaluatePrompt } from '@promptsonar/core';

export interface Assertion {
  type: 'score_min' | 'severity_limit' | 'no_findings_in_category';
  value: any;
}

export interface TestCase {
  name: string;
  prompt_file: string;
  variables?: Record<string, string>;
  assertions: Assertion[];
}

/**
 * Runs a suite of prompt unit tests defined in a JSON test configuration file.
 * Exits with code 1 if any assertions fail, allowing CI/CD gating.
 */
export async function runPromptTests(configPath: string) {
  const absoluteConfigPath = path.resolve(configPath);
  if (!fs.existsSync(absoluteConfigPath)) {
    console.error(chalk.red(`[PromptSonar Test] Config file not found at: ${configPath}`));
    process.exit(1);
  }

  try {
    const configContent = fs.readFileSync(absoluteConfigPath, 'utf-8');
    const testCases: TestCase[] = JSON.parse(configContent);

    console.log(chalk.bold.cyan(`\n🧪 Running PromptSonar Unit Test Suite (${testCases.length} test cases)...\n`));

    let passedCount = 0;
    let failedCount = 0;

    for (const test of testCases) {
      console.log(chalk.bold.white(`Running test: "${test.name}"`));
      
      const absolutePromptPath = path.resolve(path.dirname(absoluteConfigPath), test.prompt_file);
      if (!fs.existsSync(absolutePromptPath)) {
        console.error(chalk.red(`  ✗ FAIL: Prompt file not found: ${test.prompt_file}\n`));
        failedCount++;
        continue;
      }

      let promptText = fs.readFileSync(absolutePromptPath, 'utf-8');

      // Substitute variables if defined (e.g. {{variable}} or {variable})
      if (test.variables) {
        for (const [key, val] of Object.entries(test.variables)) {
          const regex1 = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
          const regex2 = new RegExp(`\\{\\s*${key}\\s*\\}`, 'g');
          promptText = promptText.replace(regex1, val).replace(regex2, val);
        }
      }

      // Run evaluation
      const result = evaluatePrompt({
        text: promptText,
        context: { filePath: test.prompt_file }
      });

      // Run assertions
      let testPassed = true;
      const failures: string[] = [];

      for (const assertion of test.assertions) {
        if (assertion.type === 'score_min') {
          const minScore = Number(assertion.value);
          if (result.score < minScore) {
            testPassed = false;
            failures.push(`Expected minimum score of ${minScore}, but got ${result.score}`);
          }
        }

        if (assertion.type === 'severity_limit') {
          const severityOrder = ['low', 'medium', 'high', 'critical'];
          const limitIndex = severityOrder.indexOf(assertion.value);
          
          if (limitIndex !== -1) {
            const breakingFindings = result.findings.filter(f => {
              const findIndex = severityOrder.indexOf(f.severity);
              return findIndex >= limitIndex;
            });

            if (breakingFindings.length > 0) {
              testPassed = false;
              failures.push(`Violation of severity limit "${assertion.value}": Found ${breakingFindings.length} issues exceeding threshold.`);
            }
          }
        }

        if (assertion.type === 'no_findings_in_category') {
          const targetCategory = assertion.value;
          const matchingFindings = result.findings.filter(f => f.category === targetCategory);
          
          if (matchingFindings.length > 0) {
            testPassed = false;
            failures.push(`Found ${matchingFindings.length} forbidden issues in category "${targetCategory}".`);
          }
        }
      }

      if (testPassed) {
        console.log(chalk.green(`  ✓ PASS (Score: ${result.score}/100)\n`));
        passedCount++;
      } else {
        console.error(chalk.red(`  ✗ FAIL (Score: ${result.score}/100)`));
        failures.forEach(f => console.error(chalk.red(`    - ${f}`)));
        console.error('');
        failedCount++;
      }
    }

    console.log(chalk.bold.white('----------------------------------------'));
    console.log(chalk.bold(`Test Run Summary:`));
    console.log(chalk.green(`  Passed: ${passedCount}`));
    if (failedCount > 0) {
      console.log(chalk.red(`  Failed: ${failedCount}`));
      console.log(chalk.bold.red(`\n❌ Prompt suite failed validations. Exiting with code 1.`));
      process.exit(1);
    } else {
      console.log(chalk.bold.green(`\n✅ All prompt unit tests passed successfully!`));
      process.exit(0);
    }

  } catch (err: any) {
    console.error(chalk.red(`[PromptSonar Test] Unexpected failure: ${err.message}`));
    process.exit(1);
  }
}
