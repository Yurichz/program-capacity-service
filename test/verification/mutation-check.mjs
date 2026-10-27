import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const root = resolve('.');
const scratch = await mkdtemp(join(tmpdir(), 'capacity-audit-mutation-'));
const output = resolve('.ci-artifacts/verification');

await mkdir(output, { recursive: true });
try {
  await cp('dist', join(scratch, 'dist'), { recursive: true });
  await cp('package.json', join(scratch, 'package.json'));
  await cp('jest.config.js', join(scratch, 'jest.config.js'));
  await mkdir(join(scratch, 'test', 'financial'), { recursive: true });
  await cp('test/financial/unit.test.mjs', join(scratch, 'test', 'financial', 'unit.test.mjs'));
  await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const run = async (name) => {
    const report = join(output, name + '.json');
    let status = 0, log = '';

    try {
      log = execFileSync(process.execPath, [
        '--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'),
        '--runInBand', '--testPathPatterns=unit', '--json', '--outputFile', report,
      ], { cwd: scratch, encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
    } catch (error) {
      status = error.status;
      log = String(error.stdout) + String(error.stderr);
    }

    await writeFile(join(output, name + '.log'), log);

    return { status, report: JSON.parse(await readFile(report, 'utf8')) };
  };

  assert.equal((await run('mutation-control')).status, 0);
  const helper = join(scratch, 'dist/helpers/capacity.helpers.js');
  const original = await readFile(helper, 'utf8');

  assert.equal(original.split('.ceil()').length, 2);
  await writeFile(helper, original.replace('.ceil()', '.floor()'));
  const mutated = await run('mutation-floor');

  assert.notEqual(mutated.status, 0);
  assert.ok(mutated.report.testResults.flatMap((suite) => suite.assertionResults).some(
    (result) => result.status === 'failed' && result.title.includes('FX rounds toward capacity consumption'),
  ));
  console.log('AUD-TEST-01 PASS: existing FX assertion kills ceil-to-floor mutation in a disposable copy.');
} finally {
  assert.ok(resolve(scratch).startsWith(resolve(tmpdir()) + sep));
  await rm(scratch, { recursive: true, force: true });
}
