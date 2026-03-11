# CLAUDE.md — tf-iac-env

## Project Overview

IaC/クラウドインフラ開発向けの Claude Code 標準環境パッケージ。
tf-standard-env（共通コア）の上に、Terraform/Bicep/Azure 固有のエージェント・ルール・スキル・コマンドを追加する。

## Prerequisites

- tf-standard-env >= 2.0.0 がインストール済みであること

## Install

```bash
# 共通コアが未インストールの場合
cd ../10_tf-standard-env && npm run install:env

# IaC パッケージをインストール
npm run install:env

# プロジェクトに CLAUDE.md を初期化
npm run install:env -- --project /path/to/iac-project
```

## Components

| カテゴリ | 数 | 内容 |
|---------|---|------|
| Agents | 5 | iac-architect, security-hardener, cost-optimizer, compliance-auditor, deployment-orchestrator |
| Rules | 10 | terraform-standards, azure-naming, network-security, identity-governance, secret-management, state-management, tagging-policy, disaster-recovery, cost-governance, compliance-baseline |
| Skills | 6 | terraform-scaffold, landing-zone, entra-id-setup, intune-policy, web-api-infra, monitoring-setup |
| Commands | 4 | /infra-review, /security-scan, /cost-check, /drift-detect |

## Key Principles

1. **Security by Default**: Entra ID, Conditional Access, Key Vault, Defender をコード化
2. **Terraform First**: HCL をメイン IaC 言語とし、Bicep を Azure ネイティブの補完に
3. **コスト意識**: Infracost 連携でデプロイ前にコスト見積もり
4. **コンプライアンス**: CIS Benchmarks, Azure Policy による継続的監査

## Claude Code の支援範囲

| レベル | 対象 |
|--------|------|
| 最適 | Terraform HCL, Bicep, CI/CD YAML, Policy JSON |
| 可能 | モジュール設計, セキュリティレビュー, コスト分析 |
| 限定的 | Azure Portal 設定の確認（CLI/API 経由） |
| 不可 | Azure Portal GUI 操作, ライセンス購入 |
