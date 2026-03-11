---
name: security-scan
description: IaC コードのセキュリティ監査とスコアカード生成
---

# /security-scan

## 概要

Terraform / Bicep コードに対してセキュリティ重点の監査を実行し、
セキュリティスコアカードと改善ステップを出力するコマンド。

tfsec / checkov 相当の静的解析観点に加え、Azure 固有のセキュリティベストプラクティスを
包括的にチェックする。

## 実行フロー

### Phase 1: スキャン対象の特定

1. `.tf` / `.bicep` ファイルを再帰的に検出する
2. `.tfvars` ファイル内のシークレット候補をスキャンする
3. モジュール依存関係を解析する

### Phase 2: セキュリティチェック実行

以下のカテゴリを順次チェックする。

#### 1. ID とアクセス管理

| チェック ID | チェック内容 | 重大度 |
|------------|-------------|--------|
| IAM-001 | Managed Identity を使用しているか（クライアントシークレットではなく） | HIGH |
| IAM-002 | RBAC で最小権限の原則を遵守しているか | HIGH |
| IAM-003 | Owner ロールの割り当てが制限されているか | CRITICAL |
| IAM-004 | Service Principal のシークレット有効期限が短いか | MEDIUM |
| IAM-005 | カスタムロール定義が適切か（ワイルドカード `*` の使用） | HIGH |

#### 2. ネットワークセキュリティ

| チェック ID | チェック内容 | 重大度 |
|------------|-------------|--------|
| NET-001 | NSG で `0.0.0.0/0` への許可ルールがないか | CRITICAL |
| NET-002 | SSH/RDP がインターネットに公開されていないか | CRITICAL |
| NET-003 | プライベートエンドポイントを使用しているか | HIGH |
| NET-004 | サブネットに NSG が関連付けられているか | HIGH |
| NET-005 | WAF がパブリック Web エンドポイントに適用されているか | MEDIUM |
| NET-006 | VNet Service Endpoint / Private Link の使用 | MEDIUM |

#### 3. データ保護

| チェック ID | チェック内容 | 重大度 |
|------------|-------------|--------|
| DATA-001 | Storage Account でパブリックアクセスが無効化されているか | CRITICAL |
| DATA-002 | Storage Account で HTTPS 転送のみが強制されているか | HIGH |
| DATA-003 | SQL Database で TDE（透過的データ暗号化）が有効か | HIGH |
| DATA-004 | Key Vault で Soft Delete が有効化されているか | HIGH |
| DATA-005 | Key Vault で Purge Protection が有効化されているか | MEDIUM |
| DATA-006 | ディスク暗号化が有効化されているか | HIGH |

#### 4. ログと監視

| チェック ID | チェック内容 | 重大度 |
|------------|-------------|--------|
| LOG-001 | 重要リソースに Diagnostic Settings が設定されているか | HIGH |
| LOG-002 | Activity Log がエクスポートされているか | MEDIUM |
| LOG-003 | Key Vault の監査ログが有効か | HIGH |
| LOG-004 | NSG フローログが有効か | MEDIUM |
| LOG-005 | ログ保持期間が規定値（90日以上）か | MEDIUM |

#### 5. Entra ID 構成

| チェック ID | チェック内容 | 重大度 |
|------------|-------------|--------|
| AAD-001 | 条件付きアクセスで MFA が要求されているか | CRITICAL |
| AAD-002 | レガシー認証がブロックされているか | HIGH |
| AAD-003 | Break-Glass アカウントが除外されているか | HIGH |
| AAD-004 | App Registration で暗黙的フローが無効か | MEDIUM |
| AAD-005 | PIM が特権ロールに構成されているか | MEDIUM |

#### 6. コード内シークレット検出

| チェック ID | チェック内容 | 重大度 |
|------------|-------------|--------|
| SEC-001 | パスワード / API キーのハードコード | CRITICAL |
| SEC-002 | 接続文字列のハードコード | CRITICAL |
| SEC-003 | TLS 1.2 未満の許可 | HIGH |
| SEC-004 | HTTP（非 HTTPS）エンドポイントの使用 | HIGH |
| SEC-005 | `.tfvars` にシークレットが含まれていないか | CRITICAL |

### Phase 3: スコアカード生成

## 出力フォーマット

```markdown
# Security Scan Report

**対象**: [プロジェクトパス]
**日時**: YYYY-MM-DD HH:MM
**スキャンバージョン**: tf-iac-env security-scan v1.0

## セキュリティスコアカード

| カテゴリ | チェック数 | 合格 | 不合格 | スコア |
|---------|-----------|------|--------|--------|
| ID とアクセス管理 | N | N | N | N% |
| ネットワーク | N | N | N | N% |
| データ保護 | N | N | N | N% |
| ログと監視 | N | N | N | N% |
| Entra ID | N | N | N | N% |
| シークレット | N | N | N | N% |
| **合計** | **N** | **N** | **N** | **N%** |

## 総合評価: A / B / C / D / F

| ランク | スコア範囲 | 説明 |
|--------|-----------|------|
| A | 90-100% | 優秀。軽微な改善のみ |
| B | 80-89% | 良好。いくつかの改善推奨 |
| C | 60-79% | 要改善。本番リリース前に対応必須 |
| D | 40-59% | 不十分。重大な問題あり |
| F | 0-39% | 不合格。即座に対応必須 |

## 検出された問題

### CRITICAL

#### [SEC-001] ハードコードされたシークレット
- **ファイル**: `variables.tf:42`
- **問題**: デフォルト値にパスワードがハードコードされている
- **改善策**:
  ```hcl
  # 修正前
  variable "db_password" {
    default = "P@ssw0rd123!"
  }

  # 修正後
  variable "db_password" {
    description = "データベースパスワード"
    type        = string
    sensitive   = true
    # default は設定しない。tfvars または環境変数で指定
  }
  ```

(以降、検出された問題を重大度順に記載)

## 改善ロードマップ

### 即時対応（CRITICAL）
1. [ ] ハードコードされたシークレットを除去
2. [ ] パブリックアクセスを無効化

### 短期対応（1週間以内）
1. [ ] Managed Identity への移行
2. [ ] 診断設定の有効化

### 中期対応（1ヶ月以内）
1. [ ] プライベートエンドポイントへの移行
2. [ ] WAF の適用
```

## 使用例

```bash
# フルスキャン
/security-scan

# 特定カテゴリのみ
/security-scan --category network

# CRITICAL のみ表示
/security-scan --severity critical
```
