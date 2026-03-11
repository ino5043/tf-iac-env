# ID ガバナンス・アクセス管理規約

Microsoft Entra ID (Azure AD) による認証・認可・ガバナンスの必須ルール。Conditional Access、PIM、RBAC、Managed Identity に適用する。

---

## 1. Entra ID アーキテクチャ

### 1.1 テナント設計原則

| 原則 | 説明 |
|------|------|
| シングルテナント | 1 組織 = 1 テナントを基本とする |
| 管理グループ階層 | Root → Organization → Platform / Landing Zones → 環境別 |
| 特権アクセスの分離 | 管理者アカウントと日常業務アカウントを分離する |
| ゼロトラスト | 「常に検証、決して信頼しない」を基本方針とする |

### 1.2 管理グループ階層

```
Root Management Group
├── Platform
│   ├── Identity (Entra ID, DNS)
│   ├── Management (Log Analytics, Automation)
│   └── Connectivity (Hub VNet, Firewall, VPN)
├── Landing Zones
│   ├── Production
│   │   ├── Subscription: Prod-App-001
│   │   └── Subscription: Prod-Data-001
│   ├── Staging
│   │   └── Subscription: Stg-App-001
│   └── Development
│       └── Subscription: Dev-App-001
├── Sandbox
│   └── Subscription: Sandbox-001
└── Decommissioned
    └── (廃止予定のサブスクリプション)
```

---

## 2. Conditional Access（条件付きアクセス）

### 2.1 必須ポリシー

すべてのテナントで以下の Conditional Access ポリシーを構成する。

| ポリシー名 | 対象 | 条件 | 制御 |
|-----------|------|------|------|
| CA-001: MFA 必須（全ユーザー） | 全ユーザー | すべてのクラウドアプリ | MFA 必須 |
| CA-002: 管理者 MFA 強制 | 管理者ロール | すべてのアプリ | MFA 必須 + 準拠デバイス |
| CA-003: レガシー認証ブロック | 全ユーザー | レガシー認証クライアント | ブロック |
| CA-004: リスクベースサインイン | 全ユーザー | サインインリスク Medium 以上 | MFA 必須 |
| CA-005: デバイスコンプライアンス | 全ユーザー | 社内アプリ | 準拠デバイス必須 |
| CA-006: 場所ベース制限 | 全ユーザー | 信頼できない場所 | MFA 必須 |
| CA-007: ゲストアクセス制限 | ゲストユーザー | すべてのアプリ | MFA 必須 + 利用規約同意 |

### 2.2 Terraform 実装例

```hcl
# Conditional Access: 全ユーザー MFA 必須
resource "azuread_conditional_access_policy" "require_mfa_all_users" {
  display_name = "CA-001: MFA Required for All Users"
  state        = "enabled"

  conditions {
    client_app_types = ["browser", "mobileAppsAndDesktopClients"]

    applications {
      included_applications = ["All"]
    }

    users {
      included_users = ["All"]
      excluded_users = [azuread_user.break_glass_account.object_id]
    }

    locations {
      included_locations = ["All"]
      excluded_locations = ["AllTrusted"]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["mfa"]
  }
}

# Conditional Access: レガシー認証ブロック
resource "azuread_conditional_access_policy" "block_legacy_auth" {
  display_name = "CA-003: Block Legacy Authentication"
  state        = "enabled"

  conditions {
    client_app_types = ["exchangeActiveSync", "other"]

    applications {
      included_applications = ["All"]
    }

    users {
      included_users = ["All"]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["block"]
  }
}

# Conditional Access: デバイスコンプライアンス必須
resource "azuread_conditional_access_policy" "require_compliant_device" {
  display_name = "CA-005: Require Compliant Device"
  state        = "enabled"

  conditions {
    client_app_types = ["browser", "mobileAppsAndDesktopClients"]

    applications {
      included_applications = var.corporate_app_ids
    }

    users {
      included_users  = ["All"]
      excluded_groups = [azuread_group.ca_exclusion_group.object_id]
    }

    platforms {
      included_platforms = ["all"]
      excluded_platforms = ["linux"]
    }
  }

  grant_controls {
    operator          = "AND"
    built_in_controls = ["compliantDevice"]
  }
}
```

### 2.3 Intune デバイスコンプライアンスとの連携

Conditional Access の「準拠デバイス」要件は Intune のコンプライアンスポリシーと連動する。

| Intune コンプライアンス項目 | Windows | iOS/Android |
|---------------------------|---------|-------------|
| OS 最小バージョン | Windows 11 23H2 以上 | iOS 17+ / Android 14+ |
| BitLocker / デバイス暗号化 | 必須 | 必須 |
| ウイルス対策 | Microsoft Defender 必須 | - |
| ファイアウォール | 有効 | - |
| パスコード / PIN | 6桁以上 | 6桁以上 |
| 脱獄 / Root 検出 | - | ブロック |
| Microsoft Defender リスクスコア | Medium 以下 | Medium 以下 |

---

## 3. PIM（Privileged Identity Management）

### 3.1 基本原則

- **Just-In-Time (JIT)**: 特権ロールは常時有効にしない。必要時にアクティベーションする
- **最小特権**: 必要最小限のロールのみ割り当てる
- **承認ワークフロー**: 高特権ロールのアクティベーションには承認を必須とする
- **定期レビュー**: アクセスレビューで不要な権限を定期的に棚卸しする

### 3.2 ロール別 PIM 設定

| ロール | 最大有効期間 | 承認要否 | MFA 要否 | 理由必須 |
|--------|-----------|---------|---------|---------|
| Global Administrator | 1 時間 | 必須 | 必須 | 必須 |
| Privileged Role Administrator | 2 時間 | 必須 | 必須 | 必須 |
| Security Administrator | 4 時間 | 必須 | 必須 | 必須 |
| Subscription Owner | 4 時間 | 必須 | 必須 | 必須 |
| Subscription Contributor | 8 時間 | 不要 | 必須 | 必須 |
| User Administrator | 4 時間 | 必須 | 必須 | 必須 |

### 3.3 アクセスレビュー設定

| 項目 | 設定値 |
|------|--------|
| レビュー頻度 | 四半期に 1 回 |
| レビュアー | ロールの管理者またはマネージャー |
| 期間 | 14 日間 |
| 無応答時の動作 | アクセスを削除 |
| 推奨事項の表示 | 有効（非アクティブユーザーを推奨削除） |

---

## 4. App Registration（アプリ登録）

### 4.1 設計原則

| 原則 | 説明 |
|------|------|
| 最小権限の API パーミッション | 必要な Microsoft Graph 権限のみ要求する |
| 証明書認証優先 | クライアントシークレットより証明書を優先する |
| シークレットの有効期限 | 最大 6 ヶ月（証明書は 12 ヶ月） |
| マルチテナント設計 | 必要な場合のみ。デフォルトはシングルテナント |
| オーナーの設定 | 最低 2 名のオーナーを設定する |

### 4.2 Terraform 実装

```hcl
# ✅ GOOD: 最小権限のアプリ登録
resource "azuread_application" "api" {
  display_name     = "${var.name_prefix}-api"
  sign_in_audience = "AzureADMyOrg"  # シングルテナント

  api {
    requested_access_token_version = 2
  }

  required_resource_access {
    resource_app_id = "00000003-0000-0000-c000-000000000000"  # Microsoft Graph

    # 最小限の権限のみ
    resource_access {
      id   = "e1fe6dd8-ba31-4d61-89e7-88639da4683d"  # User.Read
      type = "Scope"
    }
  }

  web {
    redirect_uris = var.redirect_uris
    implicit_grant {
      access_token_issuance_enabled = false  # 暗黙フロー無効
      id_token_issuance_enabled     = false
    }
  }

  owners = var.app_owner_object_ids
}

# Service Principal
resource "azuread_service_principal" "api" {
  client_id                    = azuread_application.api.client_id
  app_role_assignment_required = true  # 明示的な割り当てが必要
  owners                       = var.app_owner_object_ids
}

# ❌ BAD: クライアントシークレット（有効期限が長い）
resource "azuread_application_password" "bad_example" {
  application_id = azuread_application.api.id
  display_name   = "secret"
  end_date       = "2030-01-01T00:00:00Z"  # 長すぎる
}

# ✅ GOOD: 証明書認証
resource "azuread_application_certificate" "api" {
  application_id = azuread_application.api.id
  type           = "AsymmetricX509Cert"
  value          = var.certificate_value
  end_date       = timeadd(timestamp(), "8760h")  # 1年
}
```

---

## 5. RBAC（ロールベースアクセス制御）

### 5.1 スコープ階層

```
Management Group（管理グループ）
    │
    ├── 最も広いスコープ
    │   ロール割り当ては下位に継承される
    │
    └── Subscription（サブスクリプション）
            │
            └── Resource Group（リソースグループ）
                    │
                    └── Resource（リソース）
                            │
                            └── 最も狭いスコープ（推奨）
```

**原則**: **最も狭いスコープ**でロールを割り当てる。

### 5.2 頻出 Built-in ロール

| ロール | 用途 | 推奨スコープ |
|--------|------|-------------|
| Owner | フルアクセス + RBAC 管理 | 管理グループ（PIM 経由のみ） |
| Contributor | リソース作成・管理（RBAC 管理除く） | サブスクリプション |
| Reader | 読み取り専用 | サブスクリプション or リソースグループ |
| Key Vault Secrets Officer | Key Vault シークレット管理 | Key Vault リソース |
| Key Vault Secrets User | Key Vault シークレット読み取り | Key Vault リソース |
| Storage Blob Data Contributor | Blob データ読み書き | Storage Account |
| Storage Blob Data Reader | Blob データ読み取り | Storage Account |
| AcrPush | コンテナイメージ Push | Container Registry |
| AcrPull | コンテナイメージ Pull | Container Registry |
| Azure Kubernetes Service RBAC Writer | AKS RBAC 書き込み | AKS クラスター |

### 5.3 Terraform 実装

```hcl
# ✅ GOOD: 最小スコープでのロール割り当て
resource "azurerm_role_assignment" "app_kv_reader" {
  scope                = azurerm_key_vault.main.id  # リソースレベル
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_role_assignment" "app_storage_reader" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# ❌ BAD: 広すぎるスコープでの Owner 割り当て
resource "azurerm_role_assignment" "bad_example" {
  scope                = data.azurerm_subscription.current.id  # サブスクリプション全体
  role_definition_name = "Owner"                                # 強すぎる権限
  principal_id         = var.developer_object_id                 # 個人に直接割り当て
}

# ✅ GOOD: グループ経由で Contributor を必要なスコープに割り当て
resource "azurerm_role_assignment" "dev_team_contributor" {
  scope                = azurerm_resource_group.dev.id  # リソースグループ
  role_definition_name = "Contributor"
  principal_id         = azuread_group.dev_team.object_id  # グループ経由
}
```

### 5.4 カスタムロール

Built-in ロールが要件を満たさない場合のみ、カスタムロールを作成する。

```hcl
resource "azurerm_role_definition" "app_deployer" {
  name        = "Application Deployer"
  scope       = data.azurerm_subscription.current.id
  description = "アプリケーションのデプロイに必要な最小限の権限"

  permissions {
    actions = [
      "Microsoft.Web/sites/read",
      "Microsoft.Web/sites/write",
      "Microsoft.Web/sites/restart/action",
      "Microsoft.Web/sites/slots/read",
      "Microsoft.Web/sites/slots/write",
      "Microsoft.Web/sites/slots/slotsswap/action",
      "Microsoft.Web/sites/config/read",
      "Microsoft.Web/sites/config/write",
    ]
    not_actions = []
    data_actions = [
      "Microsoft.ContainerRegistry/registries/pull/read",
    ]
    not_data_actions = []
  }

  assignable_scopes = [
    data.azurerm_subscription.current.id,
  ]
}
```

---

## 6. Managed Identity

### 6.1 System-assigned vs User-assigned

| 項目 | System-assigned | User-assigned |
|------|----------------|---------------|
| ライフサイクル | リソースと同じ | 独立管理 |
| 共有 | 不可（1:1） | 複数リソースで共有可 |
| 用途 | 単一リソース専用 | 複数リソース共通権限 |
| 管理の容易さ | 簡単（自動作成/削除） | やや複雑（明示的に管理） |
| **推奨ケース** | 単一 App Service, Function App | AKS Pod, 複数サービス共通 |

### 6.2 Terraform 実装

```hcl
# User-assigned Managed Identity（推奨: 明示的な管理）
resource "azurerm_user_assigned_identity" "app" {
  name                = "${var.name_prefix}-id-app-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

# App Service に Managed Identity を割り当て
resource "azurerm_linux_web_app" "api" {
  name                = var.app_service_name
  resource_group_name = var.resource_group_name
  location            = var.location
  service_plan_id     = azurerm_service_plan.main.id

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  site_config {
    # ...
  }

  tags = var.tags
}

# Key Vault へのアクセス権限
resource "azurerm_role_assignment" "app_kv_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Storage へのアクセス権限
resource "azurerm_role_assignment" "app_storage_blob" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# SQL Database へのアクセス権限（Entra ID 認証）
resource "azurerm_role_assignment" "app_sql" {
  scope                = azurerm_mssql_server.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}
```

### 6.3 パスワードレス接続パターン

```hcl
# ❌ BAD: 接続文字列にパスワードを埋め込む
resource "azurerm_linux_web_app" "bad_example" {
  # ...
  app_settings = {
    "SQL_CONNECTION_STRING" = "Server=myserver.database.windows.net;Database=mydb;User Id=admin;Password=P@ssw0rd;"
  }
}

# ✅ GOOD: Managed Identity による接続（パスワードレス）
resource "azurerm_linux_web_app" "api" {
  # ...
  app_settings = {
    "SQL_CONNECTION_STRING" = "Server=${azurerm_mssql_server.main.fully_qualified_domain_name};Database=${azurerm_mssql_database.main.name};Authentication=Active Directory Default;"
  }
}
```

---

## 7. Break Glass アカウント

### 7.1 設計要件

| 項目 | 設定 |
|------|------|
| アカウント数 | 2 つ（冗長化） |
| MFA | FIDO2 セキュリティキー（SMS/電話を避ける） |
| Conditional Access | 除外する |
| PIM | 対象外（常時有効） |
| パスワード | 無期限、最低 24 文字 |
| 監視 | サインインログを即時アラート |
| テスト | 四半期に 1 回のサインインテスト |

---

## チェックリスト

### Conditional Access 設定時
- [ ] 全ユーザー MFA 必須ポリシーを有効化したか
- [ ] レガシー認証ブロックポリシーを有効化したか
- [ ] リスクベースのポリシーを構成したか
- [ ] Break Glass アカウントを除外したか
- [ ] デバイスコンプライアンスポリシー（Intune 連携）を設定したか

### RBAC 設定時
- [ ] 最も狭いスコープでロールを割り当てているか
- [ ] 個人ではなくグループに割り当てているか
- [ ] Built-in ロールで要件を満たせないか確認したか（カスタムロール作成前）
- [ ] Owner ロールは PIM 経由のみで使用しているか

### Managed Identity 設定時
- [ ] パスワード/シークレットの代わりに Managed Identity を使用しているか
- [ ] 複数リソース共通の場合は User-assigned を使用しているか
- [ ] 必要最小限のロールのみ割り当てているか
- [ ] 接続文字列にパスワードが含まれていないか

### App Registration 設定時
- [ ] 最小権限の API パーミッションのみ要求しているか
- [ ] シークレットではなく証明書認証を使用しているか
- [ ] シークレットの有効期限が 6 ヶ月以内か
- [ ] オーナーが最低 2 名設定されているか
- [ ] 暗黙フロー（Implicit Grant）を無効化しているか
