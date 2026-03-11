#!/usr/bin/env node
/**
 * tf-iac-env インストールスクリプト
 *
 * Usage:
 *   node scripts/install.js                        # ~/.claude/ に agents/rules/commands/skills を同期
 *   node scripts/install.js --dry-run              # プレビュー（変更なし）
 *   node scripts/install.js --uninstall            # アンインストール
 *   node scripts/install.js --project <path>       # プロジェクトの CLAUDE.md に IaC セクションを追記
 *
 * 前提条件:
 *   tf-standard-env（共通コア）が先にインストールされていること。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SOURCE_DIR = path.resolve(__dirname, '..');

const COMPONENTS = [
  { src: 'agents', dest: 'agents', label: 'Agents (IaC/Cloud)' },
  { src: 'rules', dest: 'rules', label: 'Rules (IaC/Cloud)' },
  { src: 'commands', dest: 'commands', label: 'Commands (IaC/Cloud)' },
  { src: 'skills', dest: 'skills', label: 'Skills (IaC/Cloud)' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf('--project');
  return {
    dryRun: args.includes('--dry-run'),
    uninstall: args.includes('--uninstall'),
    project: projectIdx !== -1 ? args[projectIdx + 1] : null,
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDir(src, dest, dryRun) {
  const files = fs.readdirSync(src);
  let copied = 0;
  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      if (!dryRun) ensureDir(destPath);
      copied += copyDir(srcPath, destPath, dryRun);
    } else {
      const action = fs.existsSync(destPath) ? 'update' : 'create';
      console.log(`  ${action === 'create' ? '+' : '~'} ${path.relative(CLAUDE_DIR, destPath)}`);
      if (!dryRun) {
        ensureDir(path.dirname(destPath));
        fs.copyFileSync(srcPath, destPath);
      }
      copied++;
    }
  }
  return copied;
}

function getAllFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      files.push(...getAllFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function checkTfseInstalled() {
  const tfseMarkers = [
    path.join(CLAUDE_DIR, 'rules', 'solid-principles.md'),
    path.join(CLAUDE_DIR, 'agents', 'planner.md'),
  ];
  const installed = tfseMarkers.some(f => fs.existsSync(f));
  if (!installed) {
    console.warn('\n⚠ tf-standard-env（共通コア）が検出されませんでした。');
    console.warn('  先に tf-standard-env をインストールしてください:');
    console.warn('  cd tf-standard-env && npm run install:env\n');
  }
  return installed;
}

function install(options) {
  const { dryRun } = options;
  const mode = dryRun ? '[DRY RUN] ' : '';
  console.log(`\n${mode}tf-iac-env インストール`);
  console.log(`${'─'.repeat(40)}`);
  console.log(`ソース: ${SOURCE_DIR}`);
  console.log(`宛先:   ${CLAUDE_DIR}\n`);
  checkTfseInstalled();
  let totalFiles = 0;
  for (const comp of COMPONENTS) {
    const srcPath = path.join(SOURCE_DIR, comp.src);
    const destPath = path.join(CLAUDE_DIR, comp.dest);
    if (!fs.existsSync(srcPath)) {
      console.log(`⚠ ${comp.label}: ソースが見つかりません (${srcPath})`);
      continue;
    }
    console.log(`${comp.label}:`);
    if (!dryRun) ensureDir(destPath);
    totalFiles += copyDir(srcPath, destPath, dryRun);
    console.log();
  }
  console.log(`${'─'.repeat(40)}`);
  console.log(`${mode}${totalFiles} ファイルを処理しました`);
  if (dryRun) console.log('\n--dry-run なし で実行すると実際にインストールされます');
}

function uninstall() {
  console.log('\ntf-iac-env アンインストール');
  console.log(`${'─'.repeat(40)}`);
  let removed = 0;
  for (const comp of COMPONENTS) {
    const srcPath = path.join(SOURCE_DIR, comp.src);
    if (!fs.existsSync(srcPath)) continue;
    const files = getAllFiles(srcPath);
    for (const file of files) {
      const relative = path.relative(srcPath, file);
      const destFile = path.join(CLAUDE_DIR, comp.dest, relative);
      if (fs.existsSync(destFile)) {
        console.log(`  - ${path.relative(CLAUDE_DIR, destFile)}`);
        fs.unlinkSync(destFile);
        removed++;
      }
    }
  }
  console.log(`${'─'.repeat(40)}`);
  console.log(`${removed} ファイルを削除しました（共通コアは維持）`);
}

const MARKER = '## Development Workflow（TFSE-IaC 準拠）';
const SECTION = `
---

## Development Workflow（TFSE-IaC 準拠）

このプロジェクトには TFSE-IaC がインストールされています。
共通ルールは tf-standard-env、IaC/クラウド固有ルールは tf-iac-env から提供されます。

### IaC 開発ワークフロー

| ステップ | コマンド | 用途 |
|---------|---------|------|
| 1. 計画 | \`/plan\` | インフラ設計を確認してから着手 |
| 2. インフラレビュー | \`/infra-review\` | アーキ + セキュリティ + コンプライアンス |
| 3. セキュリティ | \`/security-scan\` | Entra ID, NSG, Key Vault 監査 |
| 4. コスト | \`/cost-check\` | コスト見積もり + 最適化 |
| 5. ドリフト検出 | \`/drift-detect\` | コードと実環境の差分確認 |

### 設計原則

- **Security by Default**: Entra ID + Conditional Access + Key Vault
- **Terraform First**: HCL をメイン IaC 言語
- **最小権限**: Managed Identity 優先, RBAC は最小スコープ
- **タグ必須**: 環境, コスト, オーナー, 有効期限

### Git Workflow

- **ブランチ戦略**: \`feature/xxx\` → PR → \`main\`
- **コミット形式**: \`feat:\`, \`fix:\`, \`refactor:\`, \`docs:\`, \`chore:\`
- **PR 時**: \`terraform plan\` を自動実行
- **merge 時**: \`terraform apply\` を自動実行
`;

function initProject(projectPath) {
  const targetPath = path.resolve(projectPath);
  if (!fs.existsSync(targetPath)) {
    console.error(`\nエラー: プロジェクトパスが見つかりません: ${targetPath}`);
    process.exit(1);
  }
  const claudeMdPath = path.join(targetPath, 'CLAUDE.md');
  console.log(`\ntf-iac-env プロジェクト初期化`);
  console.log(`${'─'.repeat(40)}`);
  console.log(`プロジェクト: ${targetPath}\n`);
  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    if (content.includes(MARKER)) {
      console.log(`= CLAUDE.md: TFSE-IaC セクション既存 → スキップ（冪等）`);
    } else {
      fs.appendFileSync(claudeMdPath, SECTION, 'utf8');
      console.log(`+ CLAUDE.md: TFSE-IaC セクションを追記`);
    }
  } else {
    fs.writeFileSync(claudeMdPath, `# CLAUDE.md\n${SECTION}`, 'utf8');
    console.log(`+ CLAUDE.md: TFSE-IaC テンプレートで新規作成`);
  }
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`完了！次のセッションから /infra-review, /security-scan 等が使えます。`);
}

const options = parseArgs();
if (options.uninstall) uninstall();
else if (options.project) initProject(options.project);
else install(options);
