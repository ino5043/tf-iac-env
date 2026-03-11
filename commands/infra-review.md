---
name: infra-review
description: IaC コードのアーキテクチャ・セキュリティ・コンプライアンスを並列レビュー
---

# /infra-review

## 概要

Terraform / Bicep コードを3つの観点（アーキテクチャ、セキュリティ、コンプライアンス）から
並列にレビューし、統合レポートを出力するコマンド。

iac-architect、security-hardener、compliance-auditor の3エージェントを並列実行し、
それぞれの専門領域で問題を検出する。

## 実行フロー

### Phase 1: 対象コード収集

1. カレントディレクトリの `.tf` / `.bicep` ファイルを検出する
2. モジュール構成（`modules/` ディレクトリ）を特定する
3. 変数ファイル（`.tfvars`）と State 設定を確認する

### Phase 2: 並列レビュー（3エージェント同時実行）

以下の3エージェントを **並列** に実行する。

#### エージェント 1: iac-architect（アーキテクチャレビュー）

| チェック項目 | 説明 |
|-------------|------|
| モジュール構造 | 適切に分割されているか、再利用可能か |
| 命名規則 | Azure CAF 命名規則に準拠しているか |
| 変数設計 | validation ブロック、description の有無 |
| 出力設計 | 必要な output が定義されているか |
| State 管理 | リモート Backend が設定されているか |
| 依存関係 | 循環参照、暗黙的依存がないか |
| 環境分離 | dev/staging/prod が適切に分離されているか |
| バージョン固定 | Provider と Terraform のバージョンが固定されているか |

#### エージェント 2: security-hardener（セキュリティレビュー）

| チェック項目 | 説明 |
|-------------|------|
| パブリックアクセス | Storage、DB、Key Vault がパブリック公開されていないか |
| 暗号化 | 保存時暗号化（CMK）、転送中暗号化（TLS 1.2+） |
| ネットワーク | NSG ルール、プライベートエンドポイントの使用 |
| 認証 | Managed Identity の使用、シークレットのハードコード |
| Key Vault | アクセスポリシー vs RBAC、Soft Delete 有効化 |
| RBAC | 最小権限の原則、Owner ロールの制限 |
| ログ | 診断設定の有効化、監査ログの保持 |
| WAF | Web アプリへの WAF 適用有無 |

#### エージェント 3: compliance-auditor（コンプライアンスレビュー）

| チェック項目 | 説明 |
|-------------|------|
| CIS Benchmark | Azure CIS v2.0 準拠項目のチェック |
| タグ付け | 必須タグ（Environment, Owner, ManagedBy）の有無 |
| リージョン制限 | 許可リージョン外のリソースがないか |
| コスト管理 | Budget アラート、予約の活用 |
| データ保護 | 個人情報を含むリソースの保護措置 |
| ガバナンス | Azure Policy 適用状況 |
| バックアップ | 重要リソースのバックアップ設定 |

### Phase 3: レポート統合

3エージェントの結果を統合し、重大度別に分類する。

## 出力フォーマット

```markdown
# Infrastructure Review Report

**対象**: [プロジェクトパス]
**日時**: YYYY-MM-DD HH:MM
**レビュアー**: Claude Code (iac-architect + security-hardener + compliance-auditor)

## サマリー

| 重大度 | 件数 |
|--------|------|
| CRITICAL | N 件 |
| HIGH | N 件 |
| MEDIUM | N 件 |
| LOW | N 件 |
| INFO | N 件 |

## CRITICAL / HIGH 指摘事項

### [C-001] 指摘タイトル
- **重大度**: CRITICAL
- **カテゴリ**: セキュリティ / アーキテクチャ / コンプライアンス
- **対象ファイル**: `path/to/file.tf:行番号`
- **説明**: 問題の詳細説明
- **推奨対応**: 具体的な修正方法（コード例付き）
- **参考**: CIS ベンチマーク ID / Azure ドキュメントリンク

## MEDIUM / LOW 指摘事項

(同様のフォーマット)

## 良い実装例

レビューで検出された良い実装パターンも記録する。
```

## 重大度の定義

| 重大度 | 基準 | 例 |
|--------|------|-----|
| CRITICAL | 即座に修正必須。セキュリティリスクまたはデータ損失の危険 | パブリック Storage、ハードコードされたシークレット |
| HIGH | 早急に修正すべき。本番リリース前に対応必須 | TLS 1.0 許可、診断設定なし |
| MEDIUM | 対応を推奨。リスクは限定的 | 命名規則の不統一、description 未記載 |
| LOW | 改善提案。品質向上に寄与 | 変数のデフォルト値の最適化 |
| INFO | 参考情報 | ベストプラクティスの紹介 |

## 使用例

```bash
# カレントディレクトリをレビュー
/infra-review

# 特定のモジュールをレビュー
/infra-review modules/networking

# 本番環境設定に絞ってレビュー
/infra-review environments/prod
```
