import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const packageName = '@photostructure/difit';
const [command, destination = 'package-artifact'] = process.argv.slice(2);
const artifactDirectory = resolve(destination);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const repository = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}.git`
  : manifest.repository?.url;
const expectedVersion = process.env.EXPECTED_PACKAGE_VERSION ?? manifest.version;

// npm excludes names rather than versions. Pair each approved age exception
// with an exact consumer override, and drop both once the patch is 14 days old.
const consumerAgeExceptions = [
  { name: 'body-parser', version: '2.4.0', eligibleAt: '2026-11-05T11:39:38.614Z' },
  { name: 'qs', version: '6.16.1', eligibleAt: '2026-10-28T22:06:17.002Z' },
].filter(({ eligibleAt }) => Date.now() < Date.parse(eligibleAt));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(executable, args, options = {}) {
  return execFileSync(executable, args, { encoding: 'utf8', ...options });
}

function runNpm(args, options = {}) {
  // npm's Windows launcher is a .cmd file, which execFileSync cannot execute.
  const npmCli = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((path) => existsSync(path));
  assert(npmCli, 'Cannot find npm in the selected Node.js installation');
  return run(process.execPath, [npmCli, ...args], options);
}

function verify() {
  const tarballs = readdirSync(artifactDirectory).filter((name) => name.endsWith('.tgz'));
  assert(tarballs.length === 1, 'Expected exactly one package tarball');
  const tarball = join(artifactDirectory, tarballs[0]);
  const report = JSON.parse(readFileSync(join(artifactDirectory, 'PACK.json'), 'utf8'));
  assert(report.length === 1, 'Expected exactly one npm pack report');
  const packed = report[0];
  const paths = run('tar', ['-tzf', tarball]).trim().split(/\r?\n/u);
  assert(new Set(paths).size === paths.length, 'Tarball contains duplicate paths');
  for (const path of paths) {
    assert(
      !path.includes('/../') &&
        !path.includes('\\') &&
        !/(?:^|\/)(?:site-data|site|node_modules|\.env)(?:\/|$)/u.test(path) &&
        !/\.(?:test|spec)\.[^/]+$/u.test(path),
      `Unexpected package file: ${path}`,
    );
  }
  for (const path of [
    'package/package.json',
    'package/README.md',
    'package/LICENSE',
    'package/docs/agent-conversations.md',
    'package/dist/cli/index.js',
    'package/dist/server/server.js',
    'package/dist/client/index.html',
  ]) {
    assert(paths.includes(path), `Missing runtime or attribution file: ${path}`);
  }
  assert(
    paths.some((path) => /^package\/dist\/client\/assets\/.+\.js$/u.test(path)),
    'Missing client JavaScript',
  );
  assert(
    paths.some((path) => /^package\/dist\/client\/assets\/.+\.css$/u.test(path)),
    'Missing client stylesheet',
  );
  assert(
    JSON.stringify([...packed.files.map((file) => `package/${file.path}`)].sort()) ===
      JSON.stringify([...paths].sort()),
    'npm pack report and tarball file inventory differ',
  );
  const embedded = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
  assert(
    packed.name === packageName &&
      embedded.name === packageName &&
      packed.version === expectedVersion &&
      embedded.version === expectedVersion &&
      packed.filename === basename(tarball) &&
      embedded.repository?.url === repository &&
      embedded.bin?.difit === './dist/cli/index.js',
    'Tarball name, version, repository, or CLI entrypoint does not match the release',
  );
  writeFileSync(join(artifactDirectory, 'CONTENTS.txt'), `${[...paths].sort().join('\n')}\n`);
  console.log(`Verified ${packageName}@${expectedVersion}: ${paths.length} files`);
  return tarball;
}

if (command === 'pack') {
  assert(manifest.name === packageName, `Expected source package ${packageName}`);
  assert(
    manifest.repository?.url === repository,
    'Source repository must identify the publishing repository',
  );
  mkdirSync(artifactDirectory, { recursive: true });
  assert(
    readdirSync(artifactDirectory).length === 0,
    'Package artifact directory must start empty',
  );
  const report = runNpm([
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    artifactDirectory,
  ]);
  writeFileSync(join(artifactDirectory, 'PACK.json'), report);
  verify();
} else if (command === 'verify') {
  verify();
} else if (command === 'rehearse') {
  const tarball = verify();
  const directory = mkdtempSync(join(tmpdir(), 'difit-package-'));
  try {
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        private: true,
        overrides: Object.fromEntries(
          consumerAgeExceptions.map(({ name, version }) => [name, version]),
        ),
      }),
    );
    runNpm(
      [
        'install',
        '--prefix',
        directory,
        '--ignore-scripts',
        '--min-release-age=14',
        ...consumerAgeExceptions.map(({ name }) => `--min-release-age-exclude=${name}`),
        '--package-lock=true',
        '--no-audit',
        '--no-fund',
        '--save-exact',
        tarball,
      ],
      { stdio: 'inherit' },
    );
    const audit = JSON.parse(
      runNpm(['audit', '--prefix', directory, '--omit=dev', '--audit-level=low', '--json']),
    );
    assert(
      audit.metadata?.vulnerabilities?.total === 0,
      'Installed tarball has production advisories',
    );
    const executable = join(
      directory,
      'node_modules',
      '@photostructure',
      'difit',
      'dist',
      'cli',
      'index.js',
    );
    assert(
      run(process.execPath, [executable, '--version'], { cwd: directory }).trim() ===
        expectedVersion,
      'Installed CLI version differs',
    );
    assert(
      run(process.execPath, [executable, '--help'], { cwd: directory }).includes('Usage: difit'),
      'Installed CLI help failed',
    );
    console.log('Installed tarball CLI acceptance checks passed');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
} else {
  throw new Error(
    'Usage: node scripts/release-package.mjs pack|verify|rehearse [artifact-directory]',
  );
}
