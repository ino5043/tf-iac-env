# 災害復旧（DR）設計規約

Azure 環境における災害復旧の設計・実装に関する必須ルール。RTO/RPO 設定、DR パターン、バックアップ戦略、フェイルオーバー手順に適用する。

---

## 1. DR 設計パターン

### 1.1 パターン比較

| パターン | RTO | RPO | コスト | 複雑性 | 用途 |
|---------|-----|-----|--------|--------|------|
| **Active-Active** | ~0 分 | ~0 分 | 非常に高い | 高 | ミッションクリティカル |
| **Active-Passive (Hot Standby)** | 数分 | 数分 | 高い | 中-高 | 業務継続重要システム |
| **Active-Passive (Warm Standby)** | 30 分-2 時間 | 15 分-1 時間 | 中程度 | 中 | 一般的な業務システム |
| **Pilot Light** | 2-8 時間 | 1-4 時間 | 低い | 低-中 | コスト重視の DR |
| **Backup & Restore** | 8-24 時間 | 24 時間 | 最低 | 低 | 非本番環境、低優先度 |

### 1.2 パターン詳細

#### Active-Active

```
     ┌─────────────────────────────┐
     │       Azure Front Door      │
     │     (Global Load Balancer)  │
     └──────┬────────────┬────────┘
            │            │
   ┌────────▼────────┐  ┌▼───────────────┐
   │  Japan East     │  │  Japan West    │
   │  (Primary)      │  │  (Secondary)   │
   │                 │  │                │
   │  App Service    │  │  App Service   │
   │  SQL (Read)     │  │  SQL (Read)    │
   │  Redis          │  │  Redis         │
   └────────┬────────┘  └┬──────────────┘
            │             │
   ┌────────▼─────────────▼──────────────┐
   │  Azure SQL (Failover Group)         │
   │  Auto-failover, Read replicas       │
   └─────────────────────────────────────┘
```

#### Pilot Light

```
   ┌──────────────────┐           ┌──────────────────┐
   │  Japan East      │           │  Japan West      │
   │  (Primary)       │           │  (DR - Minimal)  │
   │                  │           │                  │
   │  ┌────────────┐  │           │  ┌────────────┐  │
   │  │ App Service│  │           │  │ (停止中)   │  │
   │  │ (Running)  │  │           │  │            │  │
   │  └────────────┘  │           │  └────────────┘  │
   │  ┌────────────┐  │    Geo    │  ┌────────────┐  │
   │  │ SQL Server │  │◄────────►│  │ SQL Replica│  │
   │  │ (Primary)  │  │ Repl.    │  │ (Secondary)│  │
   │  └────────────┘  │           │  └────────────┘  │
   │  ┌────────────┐  │    GRS    │  ┌────────────┐  │
   │  │ Storage    │  │◄────────►│  │ Storage    │  │
   │  │ (Primary)  │  │           │  │ (RA-GRS)   │  │
   │  └────────────┘  │           │  └────────────┘  │
   └──────────────────┘           └──────────────────┘

   DR 発動時:
   1. App Service をスケールアップ・起動
   2. SQL Failover Group をフェイルオーバー
   3. DNS を DR サイトに切り替え
```

---

## 2. RTO/RPO の設定

### 2.1 サービスティア別の目標値

| ティア | サービス例 | RTO 目標 | RPO 目標 | DR パターン |
|--------|-----------|---------|---------|------------|
| Tier 1（ミッションクリティカル） | 決済システム、認証基盤 | < 5 分 | < 1 分 | Active-Active |
| Tier 2（業務重要） | 顧客ポータル、API 基盤 | < 1 時間 | < 15 分 | Active-Passive (Hot) |
| Tier 3（業務支援） | 社内ツール、レポート | < 4 時間 | < 1 時間 | Warm Standby |
| Tier 4（開発・テスト） | 開発環境、検証環境 | < 24 時間 | < 24 時間 | Backup & Restore |

### 2.2 Azure サービス別の DR 機能

| サービス | DR 機能 | RPO | RTO | 設定 |
|----------|---------|-----|-----|------|
| Azure SQL | Failover Group | ~5 秒 | ~30 秒 | Geo レプリケーション |
| Cosmos DB | Multi-Region Write | ~0 | ~0 | Multi-Region 有効化 |
| Azure Storage | RA-GRS | ~15 分 | ~1 時間 | GRS/RA-GRS/GZRS |
| Key Vault | Geo レプリケーション | ~数秒 | 自動 | 自動（Premium） |
| App Service | Traffic Manager + 複数リージョン | ~数分 | ~数分 | デプロイスロット |
| AKS | 複数リージョンクラスタ | ~数分 | ~数分 | GitOps で同期 |
| Redis Cache | Geo レプリケーション | ~数秒 | ~数分 | Premium SKU |

---

## 3. Azure サービスの DR 実装

### 3.1 Azure SQL Failover Group

```hcl
# プライマリ SQL Server
resource "azurerm_mssql_server" "primary" {
  name                         = "${var.name_prefix}-sql-primary-001"
  resource_group_name          = var.primary_resource_group_name
  location                     = var.primary_location
  version                      = "12.0"
  administrator_login          = var.sql_admin_login
  administrator_login_password = var.sql_admin_password

  azuread_administrator {
    login_username = var.aad_admin_login
    object_id      = var.aad_admin_object_id
  }

  tags = local.common_tags
}

# セカンダリ SQL Server（DR サイト）
resource "azurerm_mssql_server" "secondary" {
  name                         = "${var.name_prefix}-sql-secondary-001"
  resource_group_name          = var.dr_resource_group_name
  location                     = var.dr_location
  version                      = "12.0"
  administrator_login          = var.sql_admin_login
  administrator_login_password = var.sql_admin_password

  azuread_administrator {
    login_username = var.aad_admin_login
    object_id      = var.aad_admin_object_id
  }

  tags = local.common_tags
}

# データベース
resource "azurerm_mssql_database" "main" {
  name      = var.database_name
  server_id = azurerm_mssql_server.primary.id
  sku_name  = var.sql_sku_name

  tags = local.common_tags
}

# Failover Group
resource "azurerm_mssql_failover_group" "main" {
  name      = "${var.name_prefix}-sqlfg-001"
  server_id = azurerm_mssql_server.primary.id

  databases = [azurerm_mssql_database.main.id]

  partner_server {
    id = azurerm_mssql_server.secondary.id
  }

  read_write_endpoint_failover_policy {
    mode          = "Automatic"
    grace_minutes = 60
  }

  readonly_endpoint_failover_policy_enabled = true

  tags = local.common_tags
}
```

### 3.2 Geo 冗長ストレージ

```hcl
resource "azurerm_storage_account" "main" {
  name                     = var.storage_account_name
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = var.is_production ? "GZRS" : "LRS"  # 本番は Geo 冗長

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  tags = local.common_tags
}
```

### 3.3 Azure Front Door によるグローバルフェイルオーバー

```hcl
resource "azurerm_cdn_frontdoor_profile" "main" {
  name                = "${var.name_prefix}-afd-001"
  resource_group_name = var.resource_group_name
  sku_name            = "Premium_AzureFrontDoor"

  tags = local.common_tags
}

resource "azurerm_cdn_frontdoor_origin_group" "app" {
  name                     = "og-app"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
    latency_in_milliseconds     = 50
  }

  health_probe {
    path                = "/health"
    protocol            = "Https"
    interval_in_seconds = 30
    request_type        = "HEAD"
  }

  session_affinity_enabled = false
}

# プライマリオリジン（Japan East）
resource "azurerm_cdn_frontdoor_origin" "primary" {
  name                          = "origin-primary"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.app.id
  enabled                       = true

  host_name          = var.primary_app_hostname
  http_port          = 80
  https_port         = 443
  origin_host_header = var.primary_app_hostname
  priority           = 1
  weight             = 1000

  certificate_name_check_enabled = true
}

# セカンダリオリジン（Japan West - DR）
resource "azurerm_cdn_frontdoor_origin" "secondary" {
  name                          = "origin-secondary"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.app.id
  enabled                       = true

  host_name          = var.secondary_app_hostname
  http_port          = 80
  https_port         = 443
  origin_host_header = var.secondary_app_hostname
  priority           = 2
  weight             = 1000

  certificate_name_check_enabled = true
}
```

---

## 4. バックアップ戦略

### 4.1 バックアップ対象と方法

| リソース | バックアップ方法 | 保持期間 | 頻度 |
|----------|----------------|---------|------|
| Azure SQL | 自動バックアップ（PITR） | 7-35 日 | 継続的 |
| Azure SQL (長期) | Long-Term Retention (LTR) | 最大 10 年 | 週次/月次/年次 |
| VM ディスク | Azure Backup | 30-90 日 | 日次 |
| Azure Files | Azure Backup | 30 日 | 日次 |
| Blob Storage | Blob バージョニング + Soft Delete | 30 日 | 継続的 |
| AKS (etcd) | Velero | 30 日 | 日次 |
| Key Vault | Soft Delete + Purge Protection | 90 日 | 自動 |
| Cosmos DB | 自動バックアップ | 30 日 | 継続的 |

### 4.2 Azure Backup の実装

```hcl
# Recovery Services Vault
resource "azurerm_recovery_services_vault" "main" {
  name                = "${var.name_prefix}-rsv-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "Standard"

  soft_delete_enabled = true
  storage_mode_type   = "GeoRedundant"

  tags = local.common_tags
}

# バックアップポリシー（VM 用）
resource "azurerm_backup_policy_vm" "daily" {
  name                = "policy-vm-daily"
  resource_group_name = var.resource_group_name
  recovery_vault_name = azurerm_recovery_services_vault.main.name

  timezone = "Tokyo Standard Time"

  backup {
    frequency = "Daily"
    time      = "02:00"
  }

  retention_daily {
    count = 30
  }

  retention_weekly {
    count    = 12
    weekdays = ["Sunday"]
  }

  retention_monthly {
    count    = 6
    weekdays = ["Sunday"]
    weeks    = ["First"]
  }
}

# VM のバックアップ有効化
resource "azurerm_backup_protected_vm" "main" {
  for_each = var.backup_vm_ids

  resource_group_name = var.resource_group_name
  recovery_vault_name = azurerm_recovery_services_vault.main.name
  source_vm_id        = each.value
  backup_policy_id    = azurerm_backup_policy_vm.daily.id
}

# SQL Database Long-Term Retention
resource "azurerm_mssql_database" "main" {
  name      = var.database_name
  server_id = azurerm_mssql_server.primary.id
  sku_name  = var.sql_sku_name

  long_term_retention_policy {
    weekly_retention  = "P4W"   # 4週間
    monthly_retention = "P12M"  # 12ヶ月
    yearly_retention  = "P5Y"   # 5年
    week_of_year      = 1       # 年次バックアップの週
  }

  short_term_retention_policy {
    retention_days           = 35
    backup_interval_in_hours = 12
  }

  tags = local.common_tags
}
```

---

## 5. フェイルオーバーテスト

### 5.1 テスト計画

| テスト種別 | 頻度 | 範囲 | 所要時間 |
|-----------|------|------|---------|
| DR 訓練（机上演習） | 四半期 | 全システム | 2-4 時間 |
| コンポーネントフェイルオーバー | 月次 | SQL Failover Group, Storage | 30 分-1 時間 |
| 完全フェイルオーバーテスト | 年 1 回 | 全システム DR 切替 | 4-8 時間 |
| バックアップリストアテスト | 月次 | DB, ファイル | 1-2 時間 |
| Chaos Engineering | 週次 | Azure Chaos Studio | 1 時間 |

### 5.2 フェイルオーバー Runbook

```markdown
## SQL Failover Group フェイルオーバー手順

### 前提条件
- Azure Portal / CLI へのアクセス権限
- Failover Group 管理者ロール

### 手順

1. **状態確認**
   ```bash
   az sql failover-group show \
     --name <failover-group-name> \
     --resource-group <resource-group> \
     --server <primary-server>
   ```

2. **計画的フェイルオーバー（テスト時）**
   ```bash
   az sql failover-group set-primary \
     --name <failover-group-name> \
     --resource-group <dr-resource-group> \
     --server <secondary-server>
   ```

3. **強制フェイルオーバー（障害時）**
   ```bash
   az sql failover-group set-primary \
     --name <failover-group-name> \
     --resource-group <dr-resource-group> \
     --server <secondary-server> \
     --allow-data-loss
   ```

4. **フェイルオーバー後の確認**
   - アプリケーションの接続確認
   - データ整合性の確認
   - 監視アラートの確認

5. **フェイルバック（復旧後）**
   ```bash
   az sql failover-group set-primary \
     --name <failover-group-name> \
     --resource-group <primary-resource-group> \
     --server <primary-server>
   ```
```

### 5.3 Azure Chaos Studio（Chaos Engineering）

```hcl
# Chaos Studio ターゲット（VM）
resource "azurerm_chaos_studio_target" "vm" {
  location           = var.location
  target_resource_id = var.target_vm_id
  target_type        = "Microsoft-VirtualMachine"
}

# Chaos Experiment: VM シャットダウン
resource "azurerm_chaos_studio_experiment" "vm_shutdown" {
  name                = "${var.name_prefix}-chaos-vm-shutdown"
  resource_group_name = var.resource_group_name
  location            = var.location

  identity {
    type = "SystemAssigned"
  }

  selectors {
    name                    = "selector-vm"
    chaos_studio_target_ids = [azurerm_chaos_studio_target.vm.id]
  }

  steps {
    name = "step-1-shutdown"
    branches {
      name = "branch-1"
      actions {
        urn           = "urn:csci:microsoft:virtualMachine:shutdown/1.0"
        action_type   = "continuous"
        duration      = "PT10M"
        selector_name = "selector-vm"
        parameters = {
          abruptShutdown = "true"
        }
      }
    }
  }

  tags = local.common_tags
}
```

---

## 6. インフラストラクチャの復旧

### 6.1 Terraform による再構築

IaC で管理されたインフラストラクチャは、コードから再構築可能である。

```
DR 発動時のインフラ復旧手順:

1. DR 用 State バックエンドが利用可能か確認
   └→ GRS レプリケーションにより DR リージョンで利用可能

2. DR 用の tfvars を使用して plan
   └→ terraform plan -var-file="dr.tfvars"

3. DR リージョンにリソースをデプロイ
   └→ terraform apply -var-file="dr.tfvars"

4. データの復元
   └→ SQL Failover Group / Storage GRS / Backup Restore

5. DNS / Front Door の切り替え
   └→ terraform apply（DNS レコード変更）

6. アプリケーションのデプロイ
   └→ CI/CD パイプラインを DR リージョン向けに実行
```

### 6.2 DR 用 tfvars

```hcl
# dr.tfvars
location         = "japanwest"
region_code      = "jpw"
environment      = "dr"

# DR リージョンの VNet
vnet_address_space = ["10.10.0.0/16"]

# DR リージョンの SKU（コスト最適化可能な場合）
app_service_sku = "P1v3"  # プライマリと同等以上
sql_sku_name    = "S2"     # プライマリと同等以上

# DR 固有の設定
is_dr_site = true
```

---

## 7. 監視とアラート

### 7.1 DR 関連のアラート

| アラート | 条件 | 重要度 | 対応 |
|---------|------|--------|------|
| SQL Failover Group レプリケーション遅延 | lag > 5 秒 | Warning | ネットワーク確認 |
| Storage GRS レプリケーション遅延 | lag > 15 分 | Warning | Azure サポートに確認 |
| ヘルスプローブ失敗 | 3 回連続失敗 | Critical | フェイルオーバー検討 |
| バックアップ失敗 | ジョブ失敗 | Critical | 原因調査・再実行 |
| DR サイト可用性 | ヘルスチェック失敗 | Warning | DR サイト確認 |

---

## チェックリスト

### DR 設計時
- [ ] サービスティアに基づいて RTO/RPO 目標を設定したか
- [ ] 目標に合致する DR パターンを選択したか
- [ ] コストと復旧要件のトレードオフを文書化したか（ADR 推奨）
- [ ] Azure サービスの DR 機能を確認したか

### DR 実装時
- [ ] SQL Failover Group を構成したか（Tier 1-2）
- [ ] Storage を GRS / RA-GRS / GZRS で構成したか
- [ ] Front Door / Traffic Manager で DR サイトを構成したか
- [ ] Recovery Services Vault でバックアップを構成したか
- [ ] Key Vault の Geo レプリケーションを確認したか
- [ ] Terraform State のバックエンドが GRS であるか

### DR テスト時
- [ ] フェイルオーバーテストのスケジュールが設定されているか
- [ ] フェイルオーバー Runbook が最新か
- [ ] バックアップリストアテストを実施したか
- [ ] テスト結果を記録・報告したか

### 復旧手順時
- [ ] Terraform コードから DR リージョンにデプロイ可能か
- [ ] DR 用 tfvars が準備されているか
- [ ] データ復元手順が文書化されているか
- [ ] DNS / Front Door 切り替え手順が文書化されているか
- [ ] フェイルバック手順が文書化されているか
