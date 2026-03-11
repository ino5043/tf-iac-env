# シークレット管理規約

Azure Key Vault によるシークレット・鍵・証明書管理の必須ルール。アプリケーション統合とローテーション運用に適用する。

---

## 1. Key Vault 設計原則

### 1.1 Key Vault の分離戦略

| 分離単位 | 用途 | 例 |
|---------|------|-----|
| 環境別 | 環境間のシークレット漏洩防止 | `kv-tf-dev-app-001`, `kv-tf-prod-app-001` |
| ワークロード別 | 責任範囲の明確化 | `kv-tf-prod-api-001`, `kv-tf-prod-batch-001` |
| 共有 | 環境横断の証明書・鍵 | `kv-tf-shared-cert-001` |

**原則**: 1 環境 + 1 ワークロードにつき 1 Key Vault を基本とする。

### 1.2 RBAC vs アクセスポリシー

| 項目 | RBAC（推奨） | アクセスポリシー（レガシー） |
|------|-------------|--------------------------|
| 認可モデル | Azure RBAC 統一 | Key Vault 独自 |
| きめ細かさ | ロール + スコープ | テナント + オブジェクト単位 |
| 条件付きアクセス | 対応 | 非対応 |
| 監査 | Azure Activity Log 統合 | Key Vault ログのみ |
| **推奨** | **新規構築はすべて RBAC** | 既存環境の互換性のみ |

### 1.3 Terraform 実装

```hcl
resource "azurerm_key_vault" "main" {
  name                          = "${var.name_prefix}-kv-${var.workload}-001"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "standard"
  enable_rbac_authorization     = true   # RBAC モデルを使用
  purge_protection_enabled      = true   # 論理削除後の完全削除を防止
  soft_delete_retention_days    = 90     # 論理削除の保持期間
  public_network_access_enabled = false  # Private Endpoint のみ

  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }

  tags = var.tags

  lifecycle {
    prevent_destroy = true  # 誤削除防止
  }
}

# Private Endpoint
resource "azurerm_private_endpoint" "kv" {
  name                = "${var.name_prefix}-pe-kv-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id

  private_service_connection {
    name                           = "psc-kv"
    is_manual_connection           = false
    private_connection_resource_id = azurerm_key_vault.main.id
    subresource_names              = ["vault"]
  }

  private_dns_zone_group {
    name                 = "dns-zone-group"
    private_dns_zone_ids = [var.kv_private_dns_zone_id]
  }

  tags = var.tags
}

# 診断設定
resource "azurerm_monitor_diagnostic_setting" "kv" {
  name                       = "diag-kv"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category = "AuditEvent"
  }

  enabled_log {
    category = "AzurePolicyEvaluationDetails"
  }

  metric {
    category = "AllMetrics"
  }
}
```

---

## 2. シークレットの種類と管理

### 2.1 シークレットの分類

| 種類 | Key Vault タイプ | 例 | ローテーション |
|------|-----------------|-----|-------------|
| パスワード・接続文字列 | Secret | DB パスワード、API キー | 90 日 |
| 暗号化鍵 | Key | データ暗号化、署名 | 1 年 |
| TLS/SSL 証明書 | Certificate | HTTPS 証明書 | 自動更新 |
| Managed Identity トークン | (Key Vault 不要) | Azure AD 認証 | 自動 |

### 2.2 Managed Identity ファースト

**原則**: パスワード・接続文字列の使用を最小化し、Managed Identity による認証を最優先する。

```
パスワードレス接続の優先度:
  1. Managed Identity（最優先）
  2. Workload Identity Federation（外部 IdP 連携）
  3. 証明書認証
  4. Key Vault 参照経由のシークレット
  5. 環境変数のシークレット（最終手段）

❌ ハードコードされたパスワード → 絶対禁止
```

### 2.3 Managed Identity で代替可能なサービス

| サービス | 従来の認証 | Managed Identity 認証 |
|----------|-----------|---------------------|
| Azure SQL | SQL 認証（ID/PW） | Entra ID 認証 |
| Azure Storage | アクセスキー | Storage Blob Data ロール |
| Azure Service Bus | SAS キー | Azure Service Bus Data ロール |
| Azure Event Hub | SAS キー | Azure Event Hub Data ロール |
| Azure Cosmos DB | マスターキー | Cosmos DB ロール |
| Azure Key Vault | アクセスポリシー | Key Vault ロール |
| Azure Container Registry | Admin ユーザー | AcrPull / AcrPush ロール |

---

## 3. シークレットのライフサイクル

### 3.1 ローテーションポリシー

| シークレット種別 | ローテーション間隔 | 通知タイミング | 自動化 |
|----------------|------------------|-------------|--------|
| API キー | 90 日 | 有効期限 30 日前 | Event Grid + Function |
| DB パスワード | 90 日 | 有効期限 30 日前 | Event Grid + Function |
| Storage アクセスキー | 90 日 | 有効期限 30 日前 | 自動ローテーション |
| TLS 証明書 | 12 ヶ月 | 有効期限 60 日前 | Let's Encrypt / App Service 自動更新 |
| 暗号化鍵 | 12 ヶ月 | 有効期限 90 日前 | Key Vault 自動ローテーション |

### 3.2 Terraform によるローテーション設定

```hcl
# Key Vault シークレットにローテーションポリシーを設定
resource "azurerm_key_vault_secret" "db_password" {
  name         = "db-admin-password"
  value        = var.db_admin_password
  key_vault_id = azurerm_key_vault.main.id
  content_type = "password"

  expiration_date = timeadd(timestamp(), "2160h")  # 90日

  tags = {
    purpose      = "database-authentication"
    auto_rotate  = "true"
    rotate_days  = "90"
  }
}

# Event Grid によるシークレット期限切れ通知
resource "azurerm_eventgrid_system_topic" "kv" {
  name                   = "evgt-${var.name_prefix}-kv"
  resource_group_name    = var.resource_group_name
  location               = var.location
  source_arm_resource_id = azurerm_key_vault.main.id
  topic_type             = "Microsoft.KeyVault.vaults"

  tags = var.tags
}

resource "azurerm_eventgrid_system_topic_event_subscription" "secret_near_expiry" {
  name                  = "sub-secret-near-expiry"
  system_topic          = azurerm_eventgrid_system_topic.kv.name
  resource_group_name   = var.resource_group_name

  included_event_types = [
    "Microsoft.KeyVault.SecretNearExpiry",
    "Microsoft.KeyVault.SecretExpired",
    "Microsoft.KeyVault.CertificateNearExpiry",
    "Microsoft.KeyVault.CertificateExpired",
  ]

  azure_function_endpoint {
    function_id = var.rotation_function_id
  }
}
```

---

## 4. アプリケーション統合パターン

### 4.1 App Service / Function App: Key Vault 参照

```hcl
# ✅ GOOD: Key Vault 参照（@Microsoft.KeyVault 構文）
resource "azurerm_linux_web_app" "api" {
  name                = var.app_service_name
  resource_group_name = var.resource_group_name
  location            = var.location
  service_plan_id     = azurerm_service_plan.main.id

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  key_vault_reference_identity_id = azurerm_user_assigned_identity.app.id

  app_settings = {
    # Key Vault 参照（シークレットがアプリ設定にマウントされる）
    "DB_PASSWORD"   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.db_password.versionless_id})"
    "API_KEY"       = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.api_key.versionless_id})"

    # Managed Identity で認証する設定（Key Vault 参照不要）
    "SQL_CONNECTION" = "Server=${azurerm_mssql_server.main.fully_qualified_domain_name};Database=${var.db_name};Authentication=Active Directory Default;"
  }

  site_config {
    # ...
  }

  tags = var.tags
}

# ❌ BAD: シークレットを直接埋め込み
resource "azurerm_linux_web_app" "bad_example" {
  app_settings = {
    "DB_PASSWORD" = "P@ssw0rd123!"     # 平文パスワード
    "API_KEY"     = "sk-abc123def456"   # 平文 API キー
  }
}
```

### 4.2 AKS: CSI Secret Store Driver

```hcl
# AKS で Key Vault CSI Driver を有効化
resource "azurerm_kubernetes_cluster" "main" {
  name                = var.aks_cluster_name
  resource_group_name = var.resource_group_name
  location            = var.location

  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "5m"
  }

  # ...
}

# SecretProviderClass（Kubernetes マニフェスト）の例:
#
# apiVersion: secrets-store.csi.x-k8s.io/v1
# kind: SecretProviderClass
# metadata:
#   name: kv-sync
# spec:
#   provider: azure
#   parameters:
#     usePodIdentity: "false"
#     useVMManagedIdentity: "true"
#     userAssignedIdentityID: "<managed-identity-client-id>"
#     keyvaultName: "<key-vault-name>"
#     objects: |
#       array:
#         - |
#           objectName: db-password
#           objectType: secret
#     tenantId: "<tenant-id>"
```

### 4.3 GitHub Actions: OIDC (Workload Identity Federation)

```hcl
# GitHub Actions 用の Federated Credential（パスワードレス CI/CD）
resource "azuread_application" "github_actions" {
  display_name = "${var.name_prefix}-github-actions"
}

resource "azuread_service_principal" "github_actions" {
  client_id = azuread_application.github_actions.client_id
}

resource "azuread_application_federated_identity_credential" "github_main" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-main-branch"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/main"
}

resource "azuread_application_federated_identity_credential" "github_pr" {
  application_id = azuread_application.github_actions.id
  display_name   = "github-pull-request"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:${var.github_org}/${var.github_repo}:pull_request"
}
```

---

## 5. アンチパターン

### 5.1 絶対禁止事項

```hcl
# ❌ CRITICAL: .tfvars にシークレットを含めてコミット
# terraform.tfvars（Git にコミットされるファイル）
db_password = "P@ssw0rd123!"
api_key     = "sk-abc123def456"

# ❌ CRITICAL: Terraform State にシークレットが残る
resource "azurerm_key_vault_secret" "password" {
  name         = "db-password"
  value        = "P@ssw0rd123!"  # State ファイルに平文で記録される
  key_vault_id = azurerm_key_vault.main.id
}

# ❌ BAD: 出力値でシークレットを公開
output "db_password" {
  value = azurerm_key_vault_secret.password.value  # sensitive = true なし
}
```

### 5.2 State ファイルのシークレット問題と対策

Terraform State にはシークレットが平文で保存される。以下の対策を実施する。

| 対策 | 説明 |
|------|------|
| リモート State | Azure Storage Backend（暗号化済み） |
| State の暗号化 | Azure Storage の Server-Side Encryption（自動） |
| State アクセス制限 | RBAC で State Storage Account へのアクセスを制限 |
| シークレットの外部管理 | `random_password` + Key Vault で管理し、アプリは Key Vault 参照 |

```hcl
# ✅ GOOD: ランダムパスワード生成 + Key Vault 保存
resource "random_password" "db_admin" {
  length           = 24
  special          = true
  override_special = "!@#$%&*()-_=+"
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
}

resource "azurerm_key_vault_secret" "db_admin_password" {
  name            = "db-admin-password"
  value           = random_password.db_admin.result
  key_vault_id    = azurerm_key_vault.main.id
  content_type    = "password"
  expiration_date = timeadd(timestamp(), "2160h")  # 90日

  lifecycle {
    ignore_changes = [value, expiration_date]  # ローテーション後の差分を無視
  }
}
```

---

## 6. .gitignore 設定

```gitignore
# シークレットが含まれる可能性のあるファイル
*.tfvars
!*.tfvars.example
*.auto.tfvars

# 環境固有の設定
.env
.env.*

# Terraform State（ローカル State は禁止だが念のため）
*.tfstate
*.tfstate.*
*.tfstate.backup

# SSH キー
*.pem
*.key
id_rsa*
```

---

## 7. 監査とモニタリング

### 7.1 Key Vault 監査ログ

以下のイベントを Log Analytics に送信し、アラートを設定する。

| イベント | アラートレベル | 対応 |
|---------|-------------|------|
| SecretGet（大量） | Warning | 不正アクセスの可能性 |
| SecretSet（計画外） | Critical | 計画外の変更 |
| SecretDelete | Critical | 即時調査 |
| VaultAccessPolicyChange | Warning | アクセス制御の変更 |
| SecretNearExpiry | Warning | ローテーション準備 |
| SecretExpired | Critical | 即時ローテーション |

### 7.2 アラート設定例

```hcl
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "kv_unauthorized_access" {
  name                = "alert-kv-unauthorized-access"
  resource_group_name = var.resource_group_name
  location            = var.location

  evaluation_frequency = "PT5M"
  window_duration      = "PT5M"
  scopes               = [var.log_analytics_workspace_id]
  severity             = 1

  criteria {
    query = <<-QUERY
      AzureDiagnostics
      | where ResourceType == "VAULTS"
      | where ResultType == "Forbidden" or ResultType == "Unauthorized"
      | summarize count() by CallerIPAddress, OperationName, bin(TimeGenerated, 5m)
      | where count_ > 5
    QUERY

    time_aggregation_method = "Count"
    threshold               = 0
    operator                = "GreaterThan"
  }

  action {
    action_groups = [var.critical_action_group_id]
  }

  tags = var.tags
}
```

---

## チェックリスト

### Key Vault 構成時
- [ ] RBAC 認可モデル（`enable_rbac_authorization = true`）を使用しているか
- [ ] Purge Protection が有効か
- [ ] Soft Delete が有効か（90 日保持推奨）
- [ ] パブリックアクセスを無効化し、Private Endpoint を構成したか
- [ ] 診断設定で AuditEvent を Log Analytics に送信しているか
- [ ] `prevent_destroy` ライフサイクルを設定したか

### シークレット管理時
- [ ] Managed Identity でパスワードレス接続を最優先しているか
- [ ] `.tfvars` にシークレットを含めていないか
- [ ] `.gitignore` にシークレット関連ファイルを追加したか
- [ ] シークレットの有効期限（`expiration_date`）を設定したか
- [ ] ローテーションの仕組み（Event Grid + Function）を構成したか

### アプリケーション統合時
- [ ] App Service は Key Vault 参照（`@Microsoft.KeyVault`）を使用しているか
- [ ] AKS は CSI Secret Store Driver を使用しているか
- [ ] CI/CD は OIDC（Workload Identity Federation）を使用しているか
- [ ] 接続文字列にパスワードが含まれていないか

### 監査時
- [ ] Key Vault 監査ログが有効か
- [ ] 不正アクセスのアラートが設定されているか
- [ ] シークレット期限切れのアラートが設定されているか
