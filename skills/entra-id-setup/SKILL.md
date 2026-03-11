# Entra ID Setup スキル

Microsoft Entra ID（旧 Azure AD）のテナント構成、条件付きアクセスポリシー、
PIM、アプリ登録のベストプラクティスを Terraform で実装するスキル。

---

## トリガー

以下のいずれかに該当する場合にこのスキルを使用する。

- Entra ID テナントのセキュリティ構成を行う
- 条件付きアクセスポリシーを設計・実装する
- PIM（Privileged Identity Management）を設定する
- アプリ登録のベストプラクティスを適用する
- 緊急アクセスアカウントを作成する

---

## 条件付きアクセスポリシー テンプレート

### ポリシー一覧

| # | ポリシー名 | 対象 | 制御 | 優先度 |
|---|-----------|------|------|--------|
| 1 | 全ユーザー MFA 必須 | 全ユーザー | MFA | 高 |
| 2 | 準拠デバイス必須 | 企業アプリ | デバイス準拠 | 高 |
| 3 | レガシー認証ブロック | 全ユーザー | ブロック | 最高 |
| 4 | リスクベース サインイン | 全ユーザー | MFA / ブロック | 高 |
| 5 | 場所ベースの制限 | 管理者 | 許可場所のみ | 中 |
| 6 | 緊急アクセス除外 | Break-Glass | 除外 | 最高 |

### 1. 全ユーザー MFA 必須

```hcl
resource "azuread_conditional_access_policy" "require_mfa_all_users" {
  display_name = "CA001: 全ユーザー MFA 必須"
  state        = "enabledForReportingButNotEnforced" # 初期はレポートモード

  conditions {
    client_app_types = ["browser", "mobileAppsAndDesktopClients"]

    applications {
      included_applications = ["All"]
    }

    users {
      included_users  = ["All"]
      excluded_groups = [azuread_group.break_glass.id]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["mfa"]
  }
}
```

### 2. 準拠デバイス必須（企業アプリ向け）

```hcl
resource "azuread_conditional_access_policy" "require_compliant_device" {
  display_name = "CA002: 企業アプリ 準拠デバイス必須"
  state        = "enabledForReportingButNotEnforced"

  conditions {
    client_app_types = ["browser", "mobileAppsAndDesktopClients"]

    applications {
      included_applications = ["Office365"]
    }

    users {
      included_users  = ["All"]
      excluded_groups = [azuread_group.break_glass.id]
    }

    platforms {
      included_platforms = ["all"]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["compliantDevice", "domainJoinedDevice"]
  }
}
```

### 3. レガシー認証ブロック

```hcl
resource "azuread_conditional_access_policy" "block_legacy_auth" {
  display_name = "CA003: レガシー認証ブロック"
  state        = "enabled"

  conditions {
    client_app_types = ["exchangeActiveSync", "other"]

    applications {
      included_applications = ["All"]
    }

    users {
      included_users  = ["All"]
      excluded_groups = [azuread_group.break_glass.id]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["block"]
  }
}
```

### 4. リスクベース サインインポリシー

```hcl
resource "azuread_conditional_access_policy" "risk_based_signin" {
  display_name = "CA004: 高リスク サインイン MFA 必須"
  state        = "enabledForReportingButNotEnforced"

  conditions {
    client_app_types = ["browser", "mobileAppsAndDesktopClients"]

    applications {
      included_applications = ["All"]
    }

    users {
      included_users  = ["All"]
      excluded_groups = [azuread_group.break_glass.id]
    }

    sign_in_risk_levels = ["high", "medium"]
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["mfa"]
  }

  session_controls {
    sign_in_frequency {
      value = 1
      type  = "hours"
    }
  }
}
```

### 5. 場所ベースの制限（管理者向け）

```hcl
resource "azuread_named_location" "trusted_office" {
  display_name = "本社オフィス"

  ip {
    ip_ranges = [
      "203.0.113.0/24",  # 本社 IP 範囲
      "198.51.100.0/24", # VPN 出口 IP
    ]
    trusted = true
  }
}

resource "azuread_conditional_access_policy" "admin_location_restriction" {
  display_name = "CA005: 管理者 信頼された場所からのみ"
  state        = "enabledForReportingButNotEnforced"

  conditions {
    client_app_types = ["browser", "mobileAppsAndDesktopClients"]

    applications {
      included_applications = ["MicrosoftAdminPortals"]
    }

    users {
      included_roles = [
        # Global Administrator
        "62e90394-69f5-4237-9190-012177145e10",
        # Security Administrator
        "194ae4cb-b126-40b2-bd5b-6091b380977d",
      ]
      excluded_groups = [azuread_group.break_glass.id]
    }

    locations {
      included_locations = ["All"]
      excluded_locations = [azuread_named_location.trusted_office.id]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["block"]
  }
}
```

---

## PIM 構成

### Eligible ロール設定

| ロール | 対象グループ | アクティベーション上限 | 承認要否 |
|-------|-------------|---------------------|---------|
| Global Administrator | IT管理者 | 1時間 | 要承認 |
| Security Administrator | セキュリティチーム | 4時間 | 要承認 |
| User Administrator | ヘルプデスク | 8時間 | 不要 |
| Application Administrator | 開発チーム | 8時間 | 不要 |

### PIM 設計方針

```
通常時: ユーザーは Reader ロールのみ
    ↓
必要時: PIM でロールをアクティベート（正当な理由を入力）
    ↓
承認後: 制限時間内で特権ロールを使用
    ↓
期限切れ: 自動的にロール無効化
```

---

## 緊急アクセスアカウント（Break-Glass）

### 設計方針

- 最低 2 つの緊急アクセスアカウントを作成する
- すべての条件付きアクセスポリシーから除外する
- クラウド専用アカウント（オンプレミス AD と同期しない）
- MFA は FIDO2 セキュリティキー（電話番号に依存しない）
- パスワードは長く複雑で、有効期限なし
- 使用時はアラートを発報する

### Terraform 実装

```hcl
resource "azuread_user" "break_glass_1" {
  user_principal_name = "emergency-access-1@${var.tenant_domain}"
  display_name        = "Emergency Access Account 1"
  password            = var.break_glass_password_1 # Key Vault から取得

  account_enabled = true
}

resource "azuread_user" "break_glass_2" {
  user_principal_name = "emergency-access-2@${var.tenant_domain}"
  display_name        = "Emergency Access Account 2"
  password            = var.break_glass_password_2

  account_enabled = true
}

resource "azuread_group" "break_glass" {
  display_name     = "Break-Glass Accounts"
  security_enabled = true

  members = [
    azuread_user.break_glass_1.object_id,
    azuread_user.break_glass_2.object_id,
  ]
}

# Global Administrator ロールの永続割り当て
resource "azuread_directory_role_assignment" "break_glass_1_ga" {
  role_id             = "62e90394-69f5-4237-9190-012177145e10"
  principal_object_id = azuread_user.break_glass_1.object_id
}
```

---

## アプリ登録 ベストプラクティス

### 設計方針

| 項目 | 推奨 | 理由 |
|------|------|------|
| 認証方式 | 証明書 or Managed Identity | クライアントシークレットは漏洩リスク |
| シークレット有効期限 | 最大 6ヶ月 | 長期有効なシークレットは危険 |
| API 権限 | 最小権限の原則 | 必要な権限のみ付与 |
| Redirect URI | 厳密に指定 | ワイルドカード禁止 |
| 所有者 | グループ所有 | 個人依存を避ける |

### Terraform 実装

```hcl
resource "azuread_application" "web_app" {
  display_name = "MyWebApp-${var.environment}"

  sign_in_audience = "AzureADMyOrg"

  web {
    redirect_uris = [
      "https://myapp-${var.environment}.azurewebsites.net/.auth/login/aad/callback",
    ]

    implicit_grant {
      access_token_issuance_enabled = false # 暗黙的フロー無効化
      id_token_issuance_enabled     = false
    }
  }

  required_resource_access {
    resource_app_id = "00000003-0000-0000-c000-000000000000" # Microsoft Graph

    resource_access {
      id   = "e1fe6dd8-ba31-4d61-89e7-88639da4683d" # User.Read
      type = "Scope"
    }
  }

  owners = [azuread_group.app_owners.object_id]
}

resource "azuread_service_principal" "web_app" {
  client_id = azuread_application.web_app.client_id
}
```

---

## セキュリティ スコアカード

条件付きアクセス設定後、以下の項目を確認する。

| チェック項目 | 期待値 | 確認方法 |
|-------------|--------|---------|
| MFA 登録率 | > 95% | Entra ID > セキュリティ > 認証方法 |
| レガシー認証 | 0 件 | サインインログでフィルタ |
| 条件付きアクセス適用率 | 100% | ポリシーのレポートモード確認 |
| 緊急アクセステスト | 四半期ごと | 手動テスト実施 |
| PIM 使用率 | > 80% | PIM アクティベーションログ |

---

## チェックリスト

- [ ] 条件付きアクセスポリシーをレポートモードで初期展開したか
- [ ] すべてのポリシーから Break-Glass アカウントを除外したか
- [ ] レガシー認証ブロックを有効にしたか
- [ ] PIM で特権ロールの常時割り当てを解除したか
- [ ] アプリ登録で暗黙的フロー（Implicit Grant）を無効化したか
- [ ] 緊急アクセスアカウントのテスト手順を文書化したか
- [ ] サインインログの監視アラートを設定したか
