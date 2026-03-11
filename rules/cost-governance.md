# コストガバナンス規約

Azure 環境のコスト管理・最適化に関する必須ルール。予算アラート、リソース最適化、Infracost 統合に適用する。

---

## 1. 予算アラート

### 1.1 アラート閾値の設定

| 閾値 | アクション | 通知先 |
|------|-----------|--------|
| 50% | 情報通知 | チーム Slack/Teams チャネル |
| 80% | 警告通知 | チームリーダー + 財務担当 |
| 100% | 緊急通知 + 自動対応検討 | マネージャー + 財務責任者 |
| 120% | 超過通知 + 是正措置必須 | 部門長 + IT管理者 |

### 1.2 Terraform 実装

```hcl
# サブスクリプションレベルの予算
resource "azurerm_consumption_budget_subscription" "monthly" {
  name            = "budget-${var.environment}-monthly"
  subscription_id = data.azurerm_subscription.current.id
  amount          = var.monthly_budget_amount
  time_grain      = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = var.cost_alert_emails_info
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = var.cost_alert_emails_warning
    contact_groups = [azurerm_monitor_action_group.cost_warning.id]
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = var.cost_alert_emails_critical
    contact_groups = [azurerm_monitor_action_group.cost_critical.id]
  }

  # 予測ベースのアラート（月末に超過しそうな場合に早期警告）
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Forecasted"
    contact_emails = var.cost_alert_emails_warning
  }

  # タグベースのフィルタリング
  filter {
    tag {
      name   = "Environment"
      values = [var.environment]
    }
  }
}

# リソースグループレベルの予算
resource "azurerm_consumption_budget_resource_group" "app" {
  name              = "budget-${var.environment}-app"
  resource_group_id = azurerm_resource_group.app.id
  amount            = var.app_budget_amount
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = var.cost_alert_emails_warning
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = var.cost_alert_emails_critical
  }
}
```

---

## 2. Reserved Instances / Savings Plans

### 2.1 コミットメント判断基準

| 項目 | Reserved Instance | Savings Plan |
|------|------------------|-------------|
| 割引率 | 最大 72% | 最大 65% |
| 柔軟性 | SKU・リージョン固定 | SKU・リージョン柔軟 |
| 対象 | VM, SQL, Cosmos DB | コンピュート全般 |
| 期間 | 1 年 or 3 年 | 1 年 or 3 年 |
| 推奨ケース | 安定したワークロード | 変動するワークロード |

### 2.2 損益分岐点の計算

```
損益分岐月数 = RI 前払い金額 / (PAYG 月額 - RI 月額)

例: Standard_D4s_v5 (Japan East)
  PAYG:    ¥30,000/月
  1年 RI:  ¥18,000/月（前払い ¥216,000）
  節約:    ¥12,000/月

  損益分岐: ¥216,000 / ¥12,000 = 18ヶ月
  → 1年 RI の場合、12ヶ月で回収 → 購入推奨

判断基準:
  - 利用率 > 70% → RI 購入を検討
  - 利用率 > 90% → RI 購入を強く推奨
  - 利用率 < 50% → PAYG のまま
```

---

## 3. リソースの Right-sizing

### 3.1 Azure Advisor の活用

Azure Advisor は以下の推奨事項を自動的に提示する。

| 推奨カテゴリ | 内容 | 確認頻度 |
|------------|------|---------|
| コスト | 未使用リソースの削除 | 週次 |
| コスト | VM のダウンサイジング | 月次 |
| コスト | RI 購入の推奨 | 月次 |
| パフォーマンス | VM のアップサイジング | 月次 |

### 3.2 VM SKU の選択ガイドライン

| ワークロード | 推奨 SKU シリーズ | 特徴 |
|------------|-----------------|------|
| 汎用（Web/API） | `D_v5` / `D_v5s` | バランス型 |
| メモリ集約型 | `E_v5` / `E_v5s` | 高メモリ比率 |
| コンピュート集約型 | `F_v2` | 高 CPU 比率 |
| 開発・テスト | `B_v2` | バースト可能、低コスト |
| GPU | `NC_v3` / `ND_v2` | ML/AI ワークロード |

```hcl
# ✅ GOOD: 環境に応じた SKU 選択
locals {
  vm_sku_map = {
    dev  = "Standard_B2s"     # 開発: バースト型で低コスト
    stg  = "Standard_D2s_v5"  # ステージング: 汎用・小サイズ
    prod = "Standard_D4s_v5"  # 本番: 汎用・中サイズ
  }

  app_service_sku_map = {
    dev  = "B1"    # 開発: Basic
    stg  = "S1"    # ステージング: Standard
    prod = "P1v3"  # 本番: Premium v3
  }
}

resource "azurerm_service_plan" "main" {
  name                = "${var.name_prefix}-asp-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  os_type             = "Linux"
  sku_name            = local.app_service_sku_map[var.environment]

  tags = local.common_tags
}
```

---

## 4. 未使用リソースの検出

### 4.1 検出対象

| リソース | 検出条件 | 対応 |
|----------|---------|------|
| 未接続ディスク | VM に接続されていない Managed Disk | 削除 or スナップショット化 |
| アイドル VM | CPU 使用率 < 5% が 14 日以上 | 停止 or ダウンサイジング |
| 空のリソースグループ | リソースが 0 件 | 削除 |
| 未使用 Public IP | 関連リソースなし | 削除 |
| 未使用 NSG | サブネット/NIC に未関連付け | 削除 |
| 過大な Storage Account | 実使用量 < 容量の 10% | ティア変更 |
| 停止した App Service | 30 日以上停止 | 削除検討 |

### 4.2 Azure Policy による検出

```hcl
# 未接続ディスクの検出（Audit）
resource "azurerm_policy_definition" "audit_unattached_disks" {
  name         = "audit-unattached-managed-disks"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "未接続 Managed Disk の監査"

  metadata = jsonencode({
    category = "Cost Optimization"
  })

  policy_rule = jsonencode({
    if = {
      allOf = [
        {
          field  = "type"
          equals = "Microsoft.Compute/disks"
        },
        {
          field  = "Microsoft.Compute/disks/diskState"
          equals = "Unattached"
        }
      ]
    }
    then = {
      effect = "audit"
    }
  })
}

resource "azurerm_subscription_policy_assignment" "audit_unattached_disks" {
  name                 = "audit-unattached-disks"
  policy_definition_id = azurerm_policy_definition.audit_unattached_disks.id
  subscription_id      = data.azurerm_subscription.current.id
  display_name         = "未接続 Managed Disk の監査"
}
```

---

## 5. ストレージ最適化

### 5.1 アクセスティアの選択

| ティア | アクセス頻度 | 保持日数 | ストレージ単価 | アクセス単価 |
|--------|-----------|---------|-------------|------------|
| Hot | 頻繁 | - | 高い | 低い |
| Cool | 月 1-2 回 | 30 日以上 | 中程度 | 中程度 |
| Cold | 四半期 1 回 | 90 日以上 | 低い | やや高い |
| Archive | 年 1-2 回 | 180 日以上 | 最低 | 高い |

### 5.2 ライフサイクルポリシー

```hcl
resource "azurerm_storage_management_policy" "lifecycle" {
  storage_account_id = azurerm_storage_account.main.id

  rule {
    name    = "move-to-cool"
    enabled = true

    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["logs/", "backups/"]
    }

    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than    = 30
        tier_to_cold_after_days_since_modification_greater_than    = 90
        tier_to_archive_after_days_since_modification_greater_than = 180
        delete_after_days_since_modification_greater_than          = 365
      }

      snapshot {
        delete_after_days_since_creation_greater_than = 90
      }

      version {
        delete_after_days_since_creation = 90
      }
    }
  }

  rule {
    name    = "delete-old-versions"
    enabled = true

    filters {
      blob_types = ["blockBlob"]
    }

    actions {
      version {
        delete_after_days_since_creation = 30
      }
    }
  }
}
```

---

## 6. Dev/Test コスト最適化

### 6.1 VM 自動シャットダウン

```hcl
# 開発・テスト環境の VM 自動シャットダウン
resource "azurerm_dev_test_global_vm_shutdown_schedule" "auto_shutdown" {
  for_each = var.environment != "prod" ? var.vm_ids : {}

  virtual_machine_id    = each.value
  location              = var.location
  enabled               = true
  daily_recurrence_time = "2000"  # 20:00 JST
  timezone              = "Tokyo Standard Time"

  notification_settings {
    enabled         = true
    email           = var.shutdown_notification_email
    time_in_minutes = 30  # 30分前に通知
  }

  tags = local.common_tags
}
```

### 6.2 Dev/Test 価格の活用

| 最適化手法 | 節約率 | 対象 |
|-----------|--------|------|
| Dev/Test サブスクリプション | ~40% | Windows VM ライセンスなし |
| スポットインスタンス | ~90% | 中断許容ワークロード |
| B シリーズ VM | ~60% | 低使用率の開発環境 |
| 自動シャットダウン | ~50% | 業務時間外の停止 |
| App Service Free/Shared | ~100% | 検証用 Web アプリ |
| Azure Cosmos DB Free Tier | ~100% | 開発用 DB（1000 RU/s） |

### 6.3 スポットインスタンス

```hcl
# スポットインスタンスの活用（中断許容ワークロードのみ）
resource "azurerm_linux_virtual_machine" "spot" {
  count = var.environment == "dev" ? var.spot_instance_count : 0

  name                = "${var.name_prefix}-vm-spot-${format("%03d", count.index + 1)}"
  resource_group_name = var.resource_group_name
  location            = var.location
  size                = "Standard_D4s_v5"

  priority        = "Spot"
  eviction_policy = "Deallocate"
  max_bid_price   = -1  # Azure 価格で上限なし

  admin_username = var.admin_username

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts"
    version   = "latest"
  }

  tags = merge(local.common_tags, {
    InstanceType = "spot"
  })
}
```

---

## 7. Infracost 統合

### 7.1 CI/CD でのコスト見積もり

```yaml
# GitHub Actions: Infracost による PR コストコメント
name: Infracost

on:
  pull_request:
    paths:
      - '**.tf'
      - '**.tfvars'

permissions:
  contents: read
  pull-requests: write

jobs:
  infracost:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Infracost
        uses: infracost/actions/setup@v3
        with:
          api-key: ${{ secrets.INFRACOST_API_KEY }}

      - name: Checkout base branch
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.base.ref }}
          path: base

      - name: Generate Infracost diff
        run: |
          # ベースブランチのコスト
          infracost breakdown --path=base/environments/prod \
            --format=json --out-file=/tmp/infracost-base.json

          # PR ブランチのコスト
          infracost breakdown --path=environments/prod \
            --format=json --out-file=/tmp/infracost-pr.json

          # 差分レポート
          infracost diff --path=/tmp/infracost-pr.json \
            --compare-to=/tmp/infracost-base.json \
            --format=json --out-file=/tmp/infracost-diff.json

      - name: Post Infracost comment
        run: |
          infracost comment github \
            --path=/tmp/infracost-diff.json \
            --repo=${{ github.repository }} \
            --pull-request=${{ github.event.pull_request.number }} \
            --github-token=${{ github.token }} \
            --behavior=update
```

### 7.2 Infracost ポリシー

```yaml
# infracost-policy.yml
version: 0.1
policies:
  - policy: monthly-cost-increase-limit
    description: "月額コストの増加を $500 以内に制限"
    resource_type: "*"
    condition:
      monthly_cost_diff: "> 500"
    action: fail

  - policy: no-premium-storage-in-dev
    description: "開発環境での Premium Storage 使用を警告"
    resource_type: azurerm_managed_disk
    condition:
      attribute:
        storage_account_type: "Premium_LRS"
      tag:
        Environment: "dev"
    action: warn
```

---

## 8. コストレビュー体制

### 8.1 定期レビュー

| レビュー | 頻度 | 参加者 | 内容 |
|---------|------|--------|------|
| 週次コストチェック | 週 1 回 | 運用チーム | 異常検知、トレンド確認 |
| 月次コストレビュー | 月 1 回 | チームリーダー + 財務 | 予算対実績、最適化提案 |
| 四半期コスト最適化 | 四半期 | マネージャー + アーキテクト | RI 検討、アーキテクチャ改善 |

### 8.2 コストダッシュボード

```
┌─────────────────────────────────────────────────────────┐
│  Azure Cost Dashboard                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  月間予算: ¥1,000,000  │  実績: ¥650,000 (65%)         │
│  ████████████████░░░░░░░░░  予測: ¥920,000             │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  環境別コスト           │  サービス別コスト              │
│  prod:  ¥450,000 (69%)  │  Compute:  ¥350,000 (54%)    │
│  stg:   ¥120,000 (18%)  │  Database: ¥150,000 (23%)    │
│  dev:   ¥80,000  (12%)  │  Storage:  ¥80,000  (12%)    │
│                         │  Network:  ¥70,000  (11%)     │
├─────────────────────────────────────────────────────────┤
│  コスト異常検知                                         │
│  ⚠ dev-vm-001: CPU 3% (14日間) → 停止推奨             │
│  ⚠ 未接続ディスク 5件 → 削除推奨 (¥15,000/月)         │
│  ⚠ stg-sql: DTU 10% → ダウンサイジング推奨            │
└─────────────────────────────────────────────────────────┘
```

---

## チェックリスト

### 予算管理
- [ ] サブスクリプションレベルの月間予算を設定したか
- [ ] 50%, 80%, 100% の閾値でアラートを設定したか
- [ ] 予測ベースのアラートも設定したか
- [ ] リソースグループレベルの予算を設定したか（大規模環境）
- [ ] コストセンター別の予算を設定したか

### リソース最適化
- [ ] Azure Advisor の推奨事項を定期的に確認しているか
- [ ] 未使用リソース（未接続ディスク、アイドル VM）を検出しているか
- [ ] 環境に応じた適切な SKU を選択しているか
- [ ] 開発環境で自動シャットダウンを設定しているか
- [ ] ストレージのライフサイクルポリシーを設定したか

### RI / Savings Plans
- [ ] 安定したワークロードの RI 購入を検討したか
- [ ] 損益分岐点を計算したか
- [ ] RI の利用率を定期的に確認しているか

### CI/CD コスト管理
- [ ] Infracost を CI/CD に統合したか
- [ ] PR にコスト差分をコメントしているか
- [ ] コスト増加の閾値ポリシーを設定したか

### レビュー体制
- [ ] 週次コストチェックを実施しているか
- [ ] 月次コストレビューを実施しているか
- [ ] コストダッシュボードを整備しているか
