#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const packageJsonPath = resolve(repoRoot, 'package.json');

if (!existsSync(packageJsonPath)) {
  console.error('未找到 package.json，无法继续。');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const command = process.argv[2] ?? 'check';
const npmPackageName = pkg.name;
const version = pkg.version;
const forkRepo = process.env.OPENCLAW_LARK_PLUS_REPO || 'Hehejie1/openclaw-lark-plus';
const upstreamRepo = 'larksuite/openclaw-lark';
const gitTag = `v${version}`;

switch (command) {
  case 'check':
    checkEnvironment();
    break;
  case 'login:npm':
    ensureNpmLogin(true);
    break;
  case 'login:github':
    ensureGitHubLogin(true);
    break;
  case 'fork':
    ensureGitHubLogin(false);
    ensureForkRemote();
    break;
  case 'publish:npm':
    runBuildAndTests();
    ensureNpmLogin(false);
    run('npm', ['publish', '--access', 'public'], { stdio: 'inherit' });
    break;
  case 'publish:github':
    ensureGitHubLogin(false);
    ensureForkRemote();
    ensureCleanGitState();
    ensureGitTag();
    run('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
    run('git', ['push', 'origin', gitTag], { stdio: 'inherit' });
    run(
      'gh',
      ['release', 'create', gitTag, '--repo', forkRepo, '--title', `${npmPackageName} ${version}`, '--generate-notes'],
      { stdio: 'inherit' },
    );
    break;
  case 'release:all':
    runBuildAndTests();
    ensureNpmLogin(false);
    ensureGitHubLogin(false);
    ensureForkRemote();
    ensureCleanGitState();
    run('npm', ['publish', '--access', 'public'], { stdio: 'inherit' });
    ensureGitTag();
    run('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
    run('git', ['push', 'origin', gitTag], { stdio: 'inherit' });
    run(
      'gh',
      ['release', 'create', gitTag, '--repo', forkRepo, '--title', `${npmPackageName} ${version}`, '--generate-notes'],
      { stdio: 'inherit' },
    );
    break;
  default:
    console.error(`未知命令: ${command}`);
    process.exit(1);
}

function checkEnvironment() {
  console.log(`包名: ${npmPackageName}`);
  console.log(`版本: ${version}`);
  console.log(`上游仓库: ${upstreamRepo}`);
  console.log(`目标仓库: ${forkRepo}`);

  printCommandStatus('npm', ['--version']);
  printCommandStatus('gh', ['--version']);
  printCommandStatus('git', ['--version']);
  printCommandStatus('corepack', ['pnpm', '--version']);
  printCommandStatus('npm', ['whoami']);
  printCommandStatus('gh', ['auth', 'status']);

  console.log('\n推荐流程:');
  console.log('1. npm run release:fork');
  console.log('2. npm run release:login:npm');
  console.log('3. npm run release:login:github');
  console.log('4. npm run dev:link  # 本地安装调试');
  console.log('5. npm run release:npm');
  console.log('6. npm run release:github');
}

function ensureNpmLogin(interactive) {
  const whoami = spawnSync('npm', ['whoami'], { cwd: repoRoot, encoding: 'utf8' });
  if (whoami.status === 0) {
    console.log(`npm 已登录: ${whoami.stdout.trim()}`);
    return;
  }
  if (!interactive) {
    console.error('npm 未登录，请先运行 `npm run release:login:npm`。');
    process.exit(1);
  }
  run('npm', ['login'], { stdio: 'inherit' });
}

function ensureGitHubLogin(interactive) {
  const status = spawnSync('gh', ['auth', 'status'], { cwd: repoRoot, encoding: 'utf8' });
  if (status.status === 0) {
    console.log('GitHub CLI 已登录。');
    return;
  }
  if (!interactive) {
    console.error('GitHub CLI 未登录，请先运行 `npm run release:login:github`。');
    process.exit(1);
  }
  run('gh', ['auth', 'login', '-w', '-p', 'https'], { stdio: 'inherit' });
}

function ensureForkRemote() {
  renameOriginToUpstreamIfNeeded();

  const remoteUrl = capture('git', ['remote', 'get-url', 'origin'], { allowFailure: true });
  if (remoteUrl) {
    console.log(`origin 已存在: ${remoteUrl}`);
    return;
  }

  const forkExists = spawnSync('gh', ['repo', 'view', forkRepo], { cwd: repoRoot, stdio: 'ignore' }).status === 0;
  if (!forkExists) {
    run('gh', ['repo', 'fork', upstreamRepo, '--fork-name', forkRepo.split('/')[1], '--clone=false'], { stdio: 'inherit' });
  }

  const httpsRemote = `https://github.com/${forkRepo}.git`;
  run('git', ['remote', 'add', 'origin', httpsRemote], { stdio: 'inherit' });
  run('git', ['remote', 'set-url', '--push', 'origin', httpsRemote], { stdio: 'inherit' });
  console.log(`已添加 origin -> ${httpsRemote}`);
}

function renameOriginToUpstreamIfNeeded() {
  const originUrl = capture('git', ['remote', 'get-url', 'origin'], { allowFailure: true });
  const upstreamUrl = capture('git', ['remote', 'get-url', 'upstream'], { allowFailure: true });
  if (upstreamUrl) return;
  if (!originUrl) return;
  if (!originUrl.includes('/larksuite/openclaw-lark')) return;
  run('git', ['remote', 'rename', 'origin', 'upstream'], { stdio: 'inherit' });
  console.log('已将官方远程 origin 重命名为 upstream。');
}

function ensureCleanGitState() {
  const status = capture('git', ['status', '--short'], { allowFailure: false });
  if (status.trim()) {
    console.error('当前 git 工作区不干净，请先提交或暂存变更后再发版。');
    process.exit(1);
  }
}

function ensureGitTag() {
  const existing = capture('git', ['tag', '--list', gitTag], { allowFailure: false });
  if (existing.trim() === gitTag) {
    console.log(`标签 ${gitTag} 已存在。`);
    return;
  }
  run('git', ['tag', gitTag], { stdio: 'inherit' });
}

function runBuildAndTests() {
  run('corepack', ['pnpm', 'build'], { stdio: 'inherit' });
  run('corepack', ['pnpm', 'test'], { stdio: 'inherit' });
}

function printCommandStatus(commandName, args) {
  const result = spawnSync(commandName, args, { cwd: repoRoot, encoding: 'utf8' });
  const label = `${commandName} ${args.join(' ')}`;
  if (result.status === 0) {
    console.log(`[ok] ${label}`);
    if (result.stdout.trim()) {
      console.log(result.stdout.trim());
    }
    return;
  }
  console.log(`[missing/error] ${label}`);
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (output) {
    console.log(output);
  }
}

function capture(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0 && !options.allowFailure) {
    console.error(result.stderr || result.stdout || `${commandName} 执行失败`);
    process.exit(result.status ?? 1);
  }

  return (result.stdout || '').trim();
}

function run(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: repoRoot,
    stdio: options.stdio ?? 'inherit',
    encoding: options.stdio ? undefined : 'utf8',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}
