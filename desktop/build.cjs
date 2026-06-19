/**
 * 桌面打包的 staging 编排器（被 package.json 的 desktop:stage:* / desktop:build 调用）。
 *
 * 产出 desktop/.stage/{node,python,backend,frontend,default.env,db/template.db}，
 * 再由 electron-builder（desktop/builder.yml）作为 extraResources 打进 .app。
 *
 * 用法：node desktop/build.cjs <backend|frontend|python|node|env|all>
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { createWriteStream } = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGE = path.join(__dirname, '.stage');
const NODE_VERSION = 'v22.11.0'; // Node 22 LTS（standalone darwin-arm64）

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, ...opts }).toString().trim();
}

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// ── backend：编译产物 + 扁平(无符号链接) prod node_modules + prisma generate + template.db ──
// 注意：必须用 npm install 产出「扁平、真实文件」的 node_modules。pnpm deploy 用的是
// .pnpm 符号链接布局，electron-builder 拷 extraResources 时会把整个 node_modules 丢掉。
function stageBackend() {
  console.log('\n[stage:backend]');
  const out = path.join(STAGE, 'backend');
  rm(out);
  ensureDir(out);
  const src = path.join(ROOT, 'apps/backend');
  run(`cp -R ${src}/dist ${out}/dist`);
  run(`cp ${src}/package.json ${out}/package.json`);
  run(`cp ${src}/tsconfig.json ${out}/tsconfig.json`);
  run(`cp ${src}/nest-cli.json ${out}/nest-cli.json`);
  // 只拷 schema + migrations（不要 dev.db）
  ensureDir(path.join(out, 'prisma'));
  run(`cp ${src}/prisma/schema.prisma ${out}/prisma/schema.prisma`);
  run(`cp -R ${src}/prisma/migrations ${out}/prisma/migrations`);
  // 扁平、真实（npm 风格）生产依赖 —— 无符号链接、无 .pnpm，electron-builder 才会打包进去
  run('npm install --omit=dev --no-package-lock --no-audit --no-fund', { cwd: out });
  // 生成 Prisma client + native engine 进 node_modules/.prisma/client
  const schema = path.join(out, 'prisma', 'schema.prisma');
  const prismaBin = path.join(ROOT, 'apps/backend/node_modules/.bin/prisma');
  run(`${prismaBin} generate --schema=${schema}`, { cwd: out });
  // 生成预迁移的空库 template.db
  ensureDir(path.join(STAGE, 'db'));
  const tplDb = path.join(STAGE, 'db', 'template.db');
  rm(tplDb);
  process.env.DATABASE_URL = `file:${tplDb}`;
  run(`${prismaBin} migrate deploy --schema=${schema}`, { cwd: out });
  delete process.env.DATABASE_URL;
  // 运行时不需要 migrations（schema 已在 template.db + 生成的 client 里）
  rm(path.join(out, 'prisma', 'migrations'));
  // 清理 npm install 产生的缓存/锁文件
  rm(path.join(out, 'node_modules', '.cache'));
  // electron-builder 会把 extraResources 里任何名为 node_modules 的目录整体过滤掉，
  // 所以把整个 backend 打成 tar.gz 随包发布，运行时由 main.cjs 解压到 userData 并从那里运行
  // （正常 node_modules 向上查找即可解析，无需 NODE_PATH）。
  console.log('  tar → backend.tar.gz');
  execSync(`tar -czf ${path.join(STAGE, 'backend.tar.gz')} -C ${STAGE} backend`, { stdio: 'inherit' });
  rm(out);
  console.log('  backend staged ✓');
}

// ── frontend：next build → standalone + static ──
function stageFrontend() {
  console.log('\n[stage:frontend]');
  run('pnpm --filter frontend exec next build');
  const out = path.join(STAGE, 'frontend');
  rm(out);
  const standalone = path.join(ROOT, 'apps/frontend/.next/standalone');
  run(`cp -R ${standalone} ${out}`);
  // standalone 不含 static，需补到嵌套的 apps/frontend/.next/static
  const staticDest = path.join(out, 'apps/frontend/.next/static');
  ensureDir(staticDest);
  run(`cp -R ${path.join(ROOT, 'apps/frontend/.next/static')}/. ${staticDest}/`);
  // 同 backend：整个 standalone 打成 tar.gz，运行时解压到 userData（含被过滤的 node_modules）
  console.log('  tar → frontend.tar.gz');
  execSync(`tar -czf ${path.join(STAGE, 'frontend.tar.gz')} -C ${STAGE} frontend`, { stdio: 'inherit' });
  rm(out);
  console.log('  frontend staged ✓');
}

// ── python：可重定位 python-build-standalone + 依赖（装进 base 解释器 site-packages）──
function stagePython() {
  console.log('\n[stage:python]');
  run('uv python install 3.12');
  const bin = sh('uv python find 3.12');
  const pyRoot = fs.realpathSync(path.resolve(path.dirname(bin), '..'));
  const out = path.join(STAGE, 'python');
  rm(out);
  run(`cp -R ${pyRoot} ${out}`);
  const pyExe = path.join(out, 'bin/python3.12');
  // python-build-standalone 带 EXTERNALLY-MANAGED，用 --break-system-packages 装进 base 解释器
  run(
    `uv pip install --python ${pyExe} --break-system-packages ` +
    `fastapi "uvicorn[standard]" pydantic pydantic-settings openai anthropic httpx`,
  );
  // 去 __pycache__ / .pyc
  try { run(`find ${out} -type d -name __pycache__ -prune -exec rm -rf {} +`); } catch {}
  try { run(`find ${out} -name '*.pyc' -delete`); } catch {}
  console.log('  python staged ✓');
}

// ── node：下载独立 Node 22 LTS（darwin-arm64）──
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const onRes = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    };
    https.get(url, onRes).on('error', (e) => { file.close(); reject(e); });
  });
}

async function stageNode() {
  console.log('\n[stage:node]');
  const arch = process.arch; // arm64 on Apple Silicon
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform;
  const dir = `${`node-${NODE_VERSION}-${platform}-${arch}`}`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${dir}.tar.gz`;
  ensureDir(STAGE);
  const tgz = path.join(STAGE, 'node.tar.gz');
  console.log(`  downloading ${url}`);
  await download(url, tgz);
  run(`tar -xzf ${path.relative(ROOT, tgz)} -C ${path.relative(ROOT, STAGE)}`);
  fs.unlinkSync(tgz);
  // 重命名为 node/
  const out = path.join(STAGE, 'node');
  rm(out);
  fs.renameSync(path.join(STAGE, dir), out);
  console.log('  node staged ✓');
}

// ── env：写 default.env（空密钥模板，首次启动拷到 userData）──
function stageEnv() {
  console.log('\n[stage:env]');
  ensureDir(STAGE);
  const env = [
    '# NovelAssist ai-service 配置（首次启动拷到 userData；UI 的「API 配置」面板会覆盖）',
    'ANTHROPIC_AUTH_TOKEN=""',
    'ANTHROPIC_BASE_URL="https://open.bigmodel.cn/api/anthropic"',
    'ANTHROPIC_API_KEY=""',
    'ANTHROPIC_DEFAULT_MODEL="glm-5.2"',
    'MODEL_SMALL="glm-5.2"',
    'MODEL_MEDIUM="glm-5.2"',
    'MODEL_LARGE="glm-5.2"',
    'PROVIDER_SMALL="anthropic"',
    'PROVIDER_MEDIUM="anthropic"',
    'PROVIDER_LARGE="anthropic"',
    'SEMANTIC_CACHE_ENABLED="True"',
    'CORS_ORIGINS="http://localhost:3000"',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(STAGE, 'default.env'), env, 'utf8');
  console.log('  default.env written ✓');
}

async function main() {
  const step = process.argv[2] || 'all';
  ensureDir(STAGE);
  const steps = {
    backend: stageBackend,
    frontend: stageFrontend,
    python: stagePython,
    node: stageNode,
    env: stageEnv,
  };
  if (step === 'all') {
    stageBackend();
    stageFrontend();
    await stagePython();
    await stageNode();
    stageEnv();
    console.log('\n✅ desktop:build complete → desktop/.stage/');
  } else if (steps[step]) {
    await steps[step]();
  } else {
    console.error('unknown step:', step, '\nusage: node desktop/build.cjs [backend|frontend|python|node|env|all]');
    process.exit(1);
  }
}

main().catch((e) => { console.error('\n❌ staging failed:', e.message); process.exit(1); });
