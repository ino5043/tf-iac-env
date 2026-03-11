# コンプライアンスベースライン規約

Azure 環境のセキュリティ・コンプライアンスに関する必須ルール。CIS Benchmark、Azure Policy、Defender for Cloud、Intune コンプライアンス、監査ログに適用する。

---

## 1. CIS Microsoft Azure Foundations Benchmark

### 1.1 重要コントロール一覧

CIS Microsoft Azure Foundations Benchmark v2.1 の重要コントロールと Azure サービスの対応。

| CIS セクション | コントロール | Azure サービス | 実装方法 |
|---------------|-------------|---------------|---------|
| 1.1 | 全ユーザーに MFA を要求 | Entra ID | Conditional Access |
| 1.2 | Conditional Access で MFA 強制 | Entra ID | Conditional Access Policy |
| 1.3 | ゲストユーザーの定期レビュー | Entra ID | Access Reviews |
| 1.4 | レガシー認証のブロック | Entra ID | Conditional Access Policy |
| 2.1 | Defender for Cloud の有効化 | Defender for Cloud | Security posture |
| 2.2 | Secure Score の監視 | Defender for Cloud | 定期レビュー |
| 3.1 | Storage Account の安全な転送 | Storage Account | `enable_https_traffic_only` |
| 3.2 | Storage Account のパブリックアクセス無効化 | Storage Account | `allow_blob_public_access = false` |
| 3.3 | Storage Account の暗号化 | Storage Account | デフォルト有効 |
| 4.1 | SQL Server の監査有効化 | Azure SQL | Auditing |
| 4.2 | SQL Server の TDE 有効化 | Azure SQL | Transparent Data Encryption |
| 4.3 | SQL Server のファイアウォールルール | Azure SQL | Private Endpoint |
| 5.1 | Activity Log の診断設定 | Monitor | Diagnostic Settings |
| 5.2 | Log Analytics への集約 | Monitor | Log Analytics Workspace |
| 6.1 | NSG フローログの有効化 | Network Watcher | Flow Logs |
| 6.2 | RDP/SSH のインターネット公開禁止 | NSG | Security Rules |
| 7.1 | Key Vault の論理削除有効化 | Key Vault | `soft_delete_enabled` |
| 7.2 | Key Vault の Purge Protection | Key Vault | `purge_protection_enabled` |
| 8.1 | リソースロックの適用 | Management | Resource Locks |

### 1.2 CIS コントロールの Terraform 実装

```hcl
# CIS 3.1: Storage Account のセキュア転送
# CIS 3.2: パブリックアクセス無効化
# CIS 3.3: 暗号化（デフォルト有効）
resource "azurerm_storage_account" "compliant" {
  name                            = var.storage_account_name
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "GRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true   # CIS 3.1
  allow_nested_items_to_be_public = false  # CIS 3.2
  public_network_access_enabled   = false  # Private Endpoint のみ

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
  }

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  tags = local.common_tags
}

# CIS 4.1: SQL Server の監査
# CIS 4.2: TDE（デフォルト有効）
resource "azurerm_mssql_server" "compliant" {
  name                          = var.sql_server_name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false

  azuread_administrator {
    login_username              = var.aad_admin_login
    object_id                   = var.aad_admin_object_id
    azuread_authentication_only = true  # SQL 認証を無効化
  }

  tags = local.common_tags
}

# SQL Auditing
resource "azurerm_mssql_server_extended_auditing_policy" "main" {
  server_id                               = azurerm_mssql_server.compliant.id
  storage_endpoint                        = azurerm_storage_account.audit.primary_blob_endpoint
  storage_account_access_key              = azurerm_storage_account.audit.primary_access_key
  storage_account_access_key_is_secondary = false
  retention_in_days                       = 90
  log_monitoring_enabled                  = true
}

# CIS 7.1, 7.2: Key Vault のセキュリティ設定
resource "azurerm_key_vault" "compliant" {
  name                          = var.key_vault_name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  enable_rbac_authorization     = true
  soft_delete_retention_days    = 90
  purge_protection_enabled      = true
  public_network_access_enabled = false

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  tags = local.common_tags
}
```

---

## 2. Azure Policy

### 2.1 Built-in Policy Initiative（推奨）

| Initiative | ID | 用途 | 対象 |
|-----------|-----|------|------|
| CIS Microsoft Azure Foundations Benchmark v2.1 | `06f19060-9e68-4070-92ca-f15cc126059e` | CIS 準拠 | 全サブスクリプション |
| Azure Security Benchmark v3 | `1f3afdf9-d0c9-4c3d-847f-89da613e70a8` | Azure セキュリティベースライン | 全サブスクリプション |
| ISO 27001:2013 | `89c6cddc-1c73-4ac1-b19c-54d1a15a42f2` | ISO 27001 準拠 | 規制要件あり |
| NIST SP 800-53 Rev. 5 | `179d1daa-458f-4e47-8086-2a68d0d6c38f` | NIST 準拠 | 政府系要件 |
| SOC 2 Type 2 | `4054785f-702b-4a98-9215-009571ef153b` | SOC 2 準拠 | SaaS 提供者 |

### 2.2 Policy Initiative の割り当て

```hcl
# CIS Benchmark Initiative の割り当て
resource "azurerm_subscription_policy_assignment" "cis_benchmark" {
  name                 = "cis-azure-benchmark-v2"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = "/providers/Microsoft.Authorization/policySetDefinitions/06f19060-9e68-4070-92ca-f15cc126059e"
  display_name         = "CIS Microsoft Azure Foundations Benchmark v2.1"
  description          = "CIS ベンチマークに基づくセキュリティベースラインの監査"
  location             = var.location

  identity {
    type = "SystemAssigned"
  }

  # 監査モード（Audit）で開始し、問題を特定してから Deny に変更
  parameters = jsonencode({
    # ポリシーパラメータはイニシアチブに依存
  })
}

# Azure Security Benchmark
resource "azurerm_subscription_policy_assignment" "azure_security_benchmark" {
  name                 = "azure-security-benchmark-v3"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = "/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8"
  display_name         = "Azure Security Benchmark v3"
  location             = var.location

  identity {
    type = "SystemAssigned"
  }
}
```

### 2.3 カスタムポリシーの例

```hcl
# パブリック IP の作成を禁止
resource "azurerm_policy_definition" "deny_public_ip" {
  name         = "deny-public-ip-creation"
  policy_type  = "Custom"
  mode         = "All"
  display_name = "パブリック IP アドレスの作成を禁止"
  description  = "セキュリティ要件により、パブリック IP アドレスの直接作成を禁止する。"

  metadata = jsonencode({
    category = "Network"
    version  = "1.0.0"
  })

  policy_rule = jsonencode({
    if = {
      field  = "type"
      equals = "Microsoft.Network/publicIPAddresses"
    }
    then = {
      effect = "deny"
    }
  })
}

# HTTPS のみ許可（App Service）
resource "azurerm_policy_definition" "enforce_https" {
  name         = "enforce-https-app-service"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "App Service で HTTPS を強制"

  policy_rule = jsonencode({
    if = {
      allOf = [
        {
          field  = "type"
          equals = "Microsoft.Web/sites"
        },
        {
          field    = "Microsoft.Web/sites/httpsOnly"
          notEquals = "true"
        }
      ]
    }
    then = {
      effect = "deny"
    }
  })
}

# TLS 1.2 以上を強制
resource "azurerm_policy_definition" "enforce_tls12" {
  name         = "enforce-tls-12-minimum"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "TLS 1.2 以上を強制"

  policy_rule = jsonencode({
    if = {
      allOf = [
        {
          field = "type"
          in    = [
            "Microsoft.Web/sites",
            "Microsoft.Storage/storageAccounts",
            "Microsoft.Sql/servers"
          ]
        },
        {
          anyOf = [
            {
              allOf = [
                { field = "type", equals = "Microsoft.Storage/storageAccounts" },
                { field = "Microsoft.Storage/storageAccounts/minimumTlsVersion", notEquals = "TLS1_2" }
              ]
            },
            {
              allOf = [
                { field = "type", equals = "Microsoft.Sql/servers" },
                { field = "Microsoft.Sql/servers/minimalTlsVersion", notEquals = "1.2" }
              ]
            }
          ]
        }
      ]
    }
    then = {
      effect = "deny"
    }
  })
}
```

---

## 3. Microsoft Defender for Cloud

### 3.1 有効化すべきプラン

| プラン | 対象 | 推奨 | コスト |
|--------|------|------|--------|
| Defender for Servers | VM, VMSS | 必須（本番） | $15/サーバー/月 |
| Defender for App Service | App Service | 必須 | $15/インスタンス/月 |
| Defender for Storage | Storage Account | 必須 | トランザクション量に依存 |
| Defender for SQL | Azure SQL | 必須 | $15/サーバー/月 |
| Defender for Key Vault | Key Vault | 必須 | $0.02/10,000 トランザクション |
| Defender for Containers | AKS, ACR | 推奨 | $7/vCore/月 |
| Defender for DNS | DNS | 推奨 | $0.70/100万クエリ |
| CSPM (Cloud Security Posture Management) | 全体 | 必須 | 無料（基本） |

### 3.2 Terraform 実装

```hcl
# Defender for Cloud の有効化
resource "azurerm_security_center_subscription_pricing" "servers" {
  tier          = "Standard"
  resource_type = "VirtualMachines"
  subplan       = "P2"
}

resource "azurerm_security_center_subscription_pricing" "app_service" {
  tier          = "Standard"
  resource_type = "AppServices"
}

resource "azurerm_security_center_subscription_pricing" "storage" {
  tier          = "Standard"
  resource_type = "StorageAccounts"
  subplan       = "DefenderForStorageV2"
}

resource "azurerm_security_center_subscription_pricing" "sql" {
  tier          = "Standard"
  resource_type = "SqlServers"
}

resource "azurerm_security_center_subscription_pricing" "key_vault" {
  tier          = "Standard"
  resource_type = "KeyVaults"
}

resource "azurerm_security_center_subscription_pricing" "containers" {
  tier          = "Standard"
  resource_type = "Containers"
}

# Secure Score の自動プロビジョニング
resource "azurerm_security_center_auto_provisioning" "main" {
  auto_provision = "On"
}

# セキュリティ連絡先
resource "azurerm_security_center_contact" "main" {
  name                = "security-contact"
  email               = var.security_contact_email
  phone               = var.security_contact_phone
  alert_notifications = true
  alerts_to_admins    = true
}
```

### 3.3 Secure Score の目標

| スコア範囲 | 評価 | 対応 |
|-----------|------|------|
| 80-100% | 良好 | 維持・改善 |
| 60-79% | 要改善 | 30 日以内に High 推奨事項を対応 |
| 40-59% | 不十分 | 14 日以内に Critical/High を対応 |
| 0-39% | 危険 | 即時対応必須 |

---

## 4. Intune コンプライアンス

### 4.1 デバイスコンプライアンスポリシー

Conditional Access の「準拠デバイス」要件と連動するコンプライアンス設定。

| コンプライアンス項目 | Windows 11 | macOS | iOS | Android |
|--------------------|-----------|-------|-----|---------|
| OS 最小バージョン | 23H2 | 14.0 | 17.0 | 14.0 |
| デバイス暗号化 | BitLocker 必須 | FileVault 必須 | 自動 | 必須 |
| パスコード要求 | 6桁以上、英数字 | 6桁以上 | 6桁以上 | 6桁以上 |
| ウイルス対策 | Defender 必須 | - | - | - |
| ファイアウォール | 有効 | 有効 | - | - |
| 脱獄/Root 検出 | - | - | ブロック | ブロック |
| Defender リスクスコア | Medium 以下 | Medium 以下 | - | - |
| 非アクティブロック | 5 分 | 5 分 | 5 分 | 5 分 |

### 4.2 非準拠時のアクション

| 経過時間 | アクション |
|---------|-----------|
| 即時 | ユーザーに通知（メール + ポータル） |
| 1 日後 | リソースアクセスをブロック（Conditional Access 連携） |
| 7 日後 | デバイスを非準拠としてマーク（レポートに表示） |
| 30 日後 | デバイスをリモートワイプ候補としてフラグ |

---

## 5. 規制マッピング

### 5.1 コントロール → Azure サービス → 実装

| 規制コントロール | 要件 | Azure サービス | Terraform リソース |
|----------------|------|-------------|------------------|
| ISO 27001 A.9.4.1 | アクセス制御ポリシー | Entra ID + RBAC | `azurerm_role_assignment` |
| ISO 27001 A.10.1.1 | 暗号化ポリシー | Key Vault + TDE | `azurerm_key_vault` |
| ISO 27001 A.12.4.1 | イベントログ | Log Analytics | `azurerm_monitor_diagnostic_setting` |
| ISO 27001 A.13.1.1 | ネットワーク制御 | NSG + Firewall | `azurerm_network_security_group` |
| SOC 2 CC6.1 | 論理アクセス制御 | Entra ID + CA | `azuread_conditional_access_policy` |
| SOC 2 CC6.6 | ネットワークセキュリティ | NSG + WAF | `azurerm_web_application_firewall_policy` |
| SOC 2 CC7.2 | セキュリティイベント監視 | Defender for Cloud | `azurerm_security_center_*` |
| SOC 2 CC8.1 | 変更管理 | Azure DevOps / GitHub | CI/CD パイプライン |
| NIST AC-2 | アカウント管理 | Entra ID + PIM | Access Reviews |
| NIST AU-6 | 監査レビュー | Log Analytics | KQL クエリ |
| NIST SC-28 | データ保護（保存時） | Storage Encryption + TDE | デフォルト有効 |
| NIST SC-8 | データ保護（転送時） | TLS 1.2+ | `min_tls_version` |

---

## 6. 監査ログ

### 6.1 Activity Log の集約

```hcl
# サブスクリプション Activity Log を Log Analytics に送信
resource "azurerm_monitor_diagnostic_setting" "activity_log" {
  name                       = "diag-activity-log"
  target_resource_id         = data.azurerm_subscription.current.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "Administrative"
  }

  enabled_log {
    category = "Security"
  }

  enabled_log {
    category = "Alert"
  }

  enabled_log {
    category = "Policy"
  }

  enabled_log {
    category = "Autoscale"
  }

  enabled_log {
    category = "ResourceHealth"
  }

  enabled_log {
    category = "Recommendation"
  }

  enabled_log {
    category = "ServiceHealth"
  }
}
```

### 6.2 リソース診断設定の標準化

```hcl
# 診断設定モジュール（すべてのリソースに適用）
module "diagnostics" {
  source = "../../modules/diagnostics"

  for_each = {
    kv      = azurerm_key_vault.main.id
    sql     = azurerm_mssql_server.main.id
    storage = azurerm_storage_account.main.id
    app     = azurerm_linux_web_app.api.id
    nsg     = azurerm_network_security_group.app.id
  }

  target_resource_id         = each.value
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  resource_name              = each.key
}

# modules/diagnostics/main.tf
resource "azurerm_monitor_diagnostic_setting" "this" {
  name                       = "diag-${var.resource_name}"
  target_resource_id         = var.target_resource_id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  dynamic "enabled_log" {
    for_each = var.log_categories
    content {
      category = enabled_log.value
    }
  }

  metric {
    category = "AllMetrics"
  }
}
```

### 6.3 Log Analytics の保持期間

| データ種別 | 保持期間 | 理由 |
|-----------|---------|------|
| セキュリティログ | 365 日 | コンプライアンス要件 |
| 監査ログ | 90 日 | 運用調査 |
| パフォーマンスログ | 30 日 | トラブルシューティング |
| アプリケーションログ | 30 日 | デバッグ |

```hcl
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.name_prefix}-log-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 90  # デフォルト保持期間

  tags = local.common_tags
}

# セキュリティログは長期保持
resource "azurerm_log_analytics_workspace_table" "security_event" {
  workspace_id    = azurerm_log_analytics_workspace.main.id
  name            = "SecurityEvent"
  retention_in_days = 365
}
```

---

## 7. コンプライアンスレポート

### 7.1 Azure Policy コンプライアンスダッシュボード

```
┌─────────────────────────────────────────────────────────┐
│  Compliance Dashboard                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Overall Compliance: 87%                                │
│  ████████████████████░░░                                │
│                                                         │
│  Initiative         │ Compliant │ Non-Comp │ Exempt     │
│  ───────────────────┼───────────┼──────────┼──────────  │
│  CIS Benchmark v2.1 │    42     │    6     │    2       │
│  Azure Security BM  │    38     │    4     │    3       │
│  ISO 27001          │    35     │    3     │    1       │
│                                                         │
│  Top Non-Compliant Resources:                           │
│  ⚠ Storage Account 'stlegacy001' - HTTPS not enforced  │
│  ⚠ SQL Server 'sql-old-001' - Public access enabled    │
│  ⚠ VM 'vm-dev-001' - No disk encryption                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Defender for Cloud レポート

```bash
# Secure Score の取得
az security secure-scores list --output table

# 推奨事項の取得
az security assessments list \
  --query "[?status.code=='Unhealthy'].{Name:displayName, Status:status.code, Severity:metadata.severity}" \
  --output table

# Policy コンプライアンスの取得
az policy state summarize \
  --policy-set-definition "06f19060-9e68-4070-92ca-f15cc126059e" \
  --output table
```

---

## チェックリスト

### CIS Benchmark 準拠
- [ ] 全ユーザーに MFA を要求しているか（CIS 1.1）
- [ ] レガシー認証をブロックしているか（CIS 1.4）
- [ ] Storage Account でセキュア転送を強制しているか（CIS 3.1）
- [ ] Storage Account のパブリックアクセスを無効化しているか（CIS 3.2）
- [ ] SQL Server の監査を有効化しているか（CIS 4.1）
- [ ] Activity Log を Log Analytics に集約しているか（CIS 5.1）
- [ ] NSG フローログを有効化しているか（CIS 6.1）
- [ ] Key Vault の Soft Delete と Purge Protection を有効化しているか（CIS 7.1, 7.2）

### Azure Policy
- [ ] CIS Benchmark Initiative を割り当てたか
- [ ] Azure Security Benchmark を割り当てたか
- [ ] カスタムポリシー（パブリック IP 禁止、TLS 1.2 強制等）を設定したか
- [ ] ポリシーのコンプライアンス状態を定期的に確認しているか

### Defender for Cloud
- [ ] 必要なプラン（Servers, App Service, Storage, SQL, Key Vault）を有効化したか
- [ ] セキュリティ連絡先を設定したか
- [ ] Secure Score が目標値（80% 以上）を達成しているか
- [ ] High/Critical の推奨事項に対応したか

### Intune コンプライアンス
- [ ] デバイスコンプライアンスポリシーを設定したか
- [ ] OS 最小バージョン要件を設定したか
- [ ] デバイス暗号化を必須にしたか
- [ ] Conditional Access と連携してデバイス準拠を要求しているか
- [ ] 非準拠時のアクション（通知、ブロック）を設定したか

### 監査ログ
- [ ] Activity Log を Log Analytics に送信しているか
- [ ] 各リソースの診断設定が有効か
- [ ] セキュリティログの保持期間が 365 日以上か
- [ ] コンプライアンスレポートを定期的に生成しているか

### 定期レビュー
- [ ] 月次で Secure Score を確認しているか
- [ ] 四半期で Policy コンプライアンスをレビューしているか
- [ ] 年次でコンプライアンス監査を実施しているか
