---
name: drift-detect
description: Terraform State とライブインフラ間の構成ドリフトを検出・分類
---

# /drift-detect

## 概要

Terraform コードと実際の Azure インフラ間の構成ドリフトを検出し、
ドリフトの種別（意図的 / 非意図的）を分類して改善策を提示するコマンド。

`terraform plan` の差分出力を解析し、リソースごとのドリフトレポートを生成する。

## 実行フロー

### Phase 1: 環境準備

1. 対象環境（dev / staging / prod）を確認する
2. `terraform init -backend-config=environments/{env}/backend.hcl` を実行する
3. 現在の State ファイルのバージョンとタイムスタンプを確認する

### Phase 2: ドリフト検出

1. `terraform plan -var-file=environments/{env}/terraform.tfvars -detailed-exitcode` を実行する
2. Exit Code で状態を判定する

| Exit Code | 意味 | アクション |
|-----------|------|-----------|
| 0 | 変更なし（ドリフトなし） | レポートに「ドリフトなし」を記録 |
| 1 | エラー発生 | エラー詳細を記録 |
| 2 | 変更あり（ドリフト検出） | Phase 3 へ進む |

3. Plan 出力から変更されたリソースと属性を抽出する

### Phase 3: ドリフト分類

検出されたドリフトを以下のカテゴリに分類する。

#### 分類基準

| カテゴリ | 説明 | 例 |
|---------|------|-----|
| **意図的変更** | 緊急対応や手動オペレーションで意図的に変更したもの | NSG ルールの緊急追加、スケールアップ |
| **非意図的ドリフト** | 知らないうちに変更されたもの | Azure の自動更新、ポータル操作のミス |
| **コード未反映** | コードを変更したがまだ apply していないもの | 新規リソース追加、パラメータ変更 |
| **自動変更** | Azure プラットフォームによる自動変更 | タグの自動追加、バージョンの自動更新 |

#### 分類ロジック

```
ドリフト検出
    │
    ├─ リソースの作成（+）？
    │    └─ コード未反映（新規リソース）
    │
    ├─ リソースの削除（-）？
    │    └─ 手動作成されたリソースの可能性を警告
    │
    └─ リソースの変更（~）？
         │
         ├─ タグのみの変更？
         │    └─ 自動変更（低リスク）
         │
         ├─ セキュリティ関連の変更？
         │    └─ 非意図的ドリフト（要調査）
         │
         ├─ スケーリング関連の変更？
         │    └─ 意図的変更の可能性（確認必要）
         │
         └─ その他
              └─ 非意図的ドリフト（要調査）
```

### Phase 4: 改善策の提示

ドリフトの種別に応じて改善策を提示する。

| ドリフト種別 | 改善策 |
|-------------|--------|
| 意図的変更 | コードを更新して現状に合わせる（`terraform import` または手動コード更新） |
| 非意図的ドリフト | `terraform apply` で正しい状態に戻す |
| コード未反映 | `terraform apply` で変更を適用する |
| 自動変更 | `lifecycle { ignore_changes }` で無視するか、コードに反映する |

## 出力フォーマット

```markdown
# Drift Detection Report

**対象環境**: [dev / staging / prod]
**日時**: YYYY-MM-DD HH:MM
**State バージョン**: serial N, lineage: xxxxx
**最終 apply**: YYYY-MM-DD HH:MM

## サマリー

| カテゴリ | リソース数 | 重大度 |
|---------|-----------|--------|
| 意図的変更 | N | INFO |
| 非意図的ドリフト | N | HIGH |
| コード未反映 | N | MEDIUM |
| 自動変更 | N | LOW |
| **合計** | **N** | - |

## リソース別ドリフト詳細

### [DRIFT-001] azurerm_network_security_group.web_nsg

- **カテゴリ**: 非意図的ドリフト
- **重大度**: HIGH
- **変更内容**:
  ```diff
  ~ resource "azurerm_network_security_group" "web_nsg" {
      name = "nsg-web-prod"

    ~ security_rule {
        name                       = "AllowHTTP"
  -     source_address_prefix      = "10.0.0.0/8"
  +     source_address_prefix      = "0.0.0.0/0"
        destination_port_range     = "80"
        access                     = "Allow"
      }
    }
  ```
- **リスク評価**: NSG ルールがインターネット全体に公開されている。セキュリティリスクが高い。
- **推奨対応**: `terraform apply` でコードの状態に戻す
  ```bash
  terraform apply -var-file=environments/prod/terraform.tfvars -target=azurerm_network_security_group.web_nsg
  ```

### [DRIFT-002] azurerm_linux_web_app.main

- **カテゴリ**: 意図的変更
- **重大度**: INFO
- **変更内容**:
  ```diff
  ~ resource "azurerm_linux_web_app" "main" {
    ~ site_config {
  -     always_on = true
  +     always_on = false   # 緊急コスト削減で手動変更
      }
    }
  ```
- **推奨対応**: コードを更新して現状に合わせる
  ```hcl
  # main.tf を更新
  always_on = var.environment == "prod" ? true : false
  ```

### [DRIFT-003] azurerm_resource_group.app (自動変更)

- **カテゴリ**: 自動変更
- **重大度**: LOW
- **変更内容**:
  ```diff
  ~ tags = {
  +   "ms-resource-usage" = "azure-cloud-shell"
    }
  ```
- **推奨対応**: `ignore_changes` で無視する
  ```hcl
  lifecycle {
    ignore_changes = [tags["ms-resource-usage"]]
  }
  ```

## 対応優先度

### 即時対応（非意図的ドリフト）
1. [ ] [DRIFT-001] NSG ルールを修正 → `terraform apply -target=...`

### 計画的対応（コード更新）
1. [ ] [DRIFT-002] App Service の always_on 設定をコードに反映

### 任意対応（自動変更）
1. [ ] [DRIFT-003] `ignore_changes` を追加
```

## 定期実行の推奨

| 環境 | 推奨頻度 | 理由 |
|------|---------|------|
| prod | 日次 | セキュリティドリフトの早期検出 |
| staging | 週次 | リリース前の整合性確認 |
| dev | 月次 | 大きなドリフトの蓄積防止 |

## 使用例

```bash
# dev 環境のドリフト検出
/drift-detect dev

# prod 環境のドリフト検出
/drift-detect prod

# 非意図的ドリフトのみ表示
/drift-detect prod --unintentional-only

# ドリフト検出 + 自動修正提案
/drift-detect prod --auto-fix
```
