// Publishes this fork's three.quarks and quarks.r3f, as built, under an npm scope of its own: the plain npm names are
// upstream's. Each is installed under its plain name with an npm alias, so imports stay `three.quarks` and
// `three.quarks/webgpu` (the webgpu entry imports the main one by that name).
//
// usage: npm run build && node scripts/publish-scoped.mjs @scope [npm publish flags: --dry-run, --otp=123456]
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const [scope, ...flags] = process.argv.slice(2);
if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope ?? '')) {
    console.error('usage: node scripts/publish-scoped.mjs @scope [npm publish flags: --dry-run, --otp=123456]');
    process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const repo = 'https://github.com/a411919924/three.quarks';
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const core = read('packages/quarks.core/package.json');
const three = read('packages/three.quarks/package.json');

/** What the npm page says first: what this is, and how to install it under the plain names. */
function forkNote(name) {
    const aliases = [`"three.quarks": "npm:${scope}/three.quarks@^${three.version}"`];
    if (name === 'quarks.r3f') aliases.push(`"quarks.r3f": "npm:${scope}/quarks.r3f@^${three.version}"`);
    return `> **A fork of [three.quarks](https://github.com/Alchemist0823/three.quarks)** ([source](${repo})) with
> \`three.quarks/webgpu\`: node-material batches for three's \`WebGPURenderer\`. Install it under the plain name with an
> npm alias, so imports stay \`three.quarks\` and \`three.quarks/webgpu\`:
>
> \`\`\`json
> "dependencies": {
>   ${aliases.join(',\n>   ')}
> }
> \`\`\`

`;
}

for (const name of ['three.quarks', 'quarks.r3f']) {
    const dir = join(root, 'packages', name);
    const pkg = read(`packages/${name}/package.json`);
    if (!existsSync(join(dir, 'dist'))) throw new Error(`${name}: no dist; run npm run build first`);
    const stage = mkdtempSync(join(tmpdir(), `${name}-`));
    for (const file of pkg.files) {
        const from = existsSync(join(dir, file)) ? join(dir, file) : join(root, file);
        if (existsSync(from)) cpSync(from, join(stage, file), {recursive: true});
    }
    const staged = {
        ...pkg,
        name: `${scope}/${name}`,
        repository: {type: 'git', url: `git+${repo}.git`, directory: `packages/${name}`},
        bugs: {url: `${repo}/issues`},
    };
    // The workspace's scripts (husky's prepare among them) and dev tools are not the package's.
    delete staged.scripts;
    delete staged.devDependencies;
    // quarks.core is upstream's, unchanged: depend on its published release.
    if (staged.dependencies?.['quarks.core']) staged.dependencies['quarks.core'] = `^${core.version}`;
    writeFileSync(join(stage, 'package.json'), JSON.stringify(staged, null, 2) + '\n');
    // The package's README, or the repository's; its relative links point into the repository.
    const own = existsSync(join(dir, 'README.md'));
    const readme = readFileSync(own ? join(dir, 'README.md') : join(root, 'README.md'), 'utf8');
    const base = `${repo}/raw/master/${own ? `packages/${name}/` : ''}`;
    writeFileSync(join(stage, 'README.md'), forkNote(name) + readme.replaceAll('](./', `](${base}`));
    execFileSync('npm', ['publish', '--access', 'public', ...flags], {cwd: stage, stdio: 'inherit'});
    rmSync(stage, {recursive: true});
}
