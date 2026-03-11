# タグ付けポリシー規約

Azure リソースのタグ管理に関する必須ルール。コスト管理、運用管理、コンプライアンスの基盤となるタグ戦略を定義する。

---

## 1. 必須タグ

### 1.1 必須タグ一覧

すべての Azure リソースに以下のタグを付与する。タグが欠落している場合、Azure Policy で拒否する。

| タグキー | 説明 | 値の例 | 形式 |
|---------|------|--------|------|
| `Environment` | デプロイ環境 | `dev`, `stg`, `prod`, `sandbox` | Enum（小文字） |
| `CostCenter` | コストセンター/予算コード | `CC-1001`, `CC-2003` | `CC-NNNN` |
| `Owner` | 責任者のメールアドレス | `tanaka@example.com` | メールアドレス |
| `Project` | プロジェクト名 | `customer-portal`, `data-platform` | 小文字、ハイフン区切り |
| `ManagedBy` | 管理方法 | `terraform`, `bicep`, `manual` | Enum（小文字） |
| `CreatedDate` | 作成日 | `2026-03-11` | ISO 8601 日付 |

### 1.2 推奨タグ

必須ではないが、運用管理に有用なタグ。

| タグキー | 説明 | 値の例 | 形式 |
|---------|------|--------|------|
| `ExpiryDate` | リソースの有効期限 | `2026-12-31` | ISO 8601 日付 |
| `DataClassification` | データ分類 | `public`, `internal`, `confidential`, `restricted` | Enum |
| `Compliance` | 適用される規制 | `iso27001`, `soc2`, `hipaa` | Enum |
| `Application` | アプリケーション名 | `web-api`, `batch-processor` | 小文字、ハイフン区切り |
| `Team` | 担当チーム名 | `platform-team`, `app-team` | 小文字、ハイフン区切り |
| `Criticality` | ビジネス重要度 | `high`, `medium`, `low` | Enum |
| `SLA` | SLA ティア | `99.99`, `99.9`, `99` | 数値 |

---

## 2. タグ値の標準化

### 2.1 値のフォーマット規約

| ルール | 説明 | 例 |
|--------|------|-----|
| 小文字統一 | タグ値はすべて小文字 | `prod`（`Prod` や `PROD` は不可） |
| スペース不使用 | ハイフンで区切る | `data-platform`（`data platform` は不可） |
| Enum 値の固定 | 定義済みの値のみ使用 | `Environment` は `dev/stg/prod/sandbox` のみ |
| 日付フォーマット | ISO 8601 | `2026-03-11`（`2026/03/11` は不可） |
| メールアドレス | 組織ドメイン | `tanaka@example.com` |

### 2.2 Environment タグの Enum 定義

| 値 | 環境 | 用途 |
|----|------|------|
| `dev` | 開発 | 開発者の日常作業環境 |
| `stg` | ステージング | リリース前の検証環境 |
| `prod` | 本番 | エンドユーザーが使用する環境 |
| `sandbox` | サンドボックス | 実験・PoC 用の一時環境 |
| `shared` | 共有 | 全環境で共有するリソース |
| `dr` | 災害復旧 | DR サイトのリソース |

---

## 3. Terraform 実装

### 3.1 `default_tags` による一括適用

```hcl
# providers.tf
provider "azurerm" {
  features {}

  # すべてのリソースに自動適用されるデフォルトタグ
  default_tags {
    tags = {
      Environment = var.environment
      CostCenter  = var.cost_center
      Owner       = var.owner
      Project     = var.project_name
      ManagedBy   = "terraform"
      CreatedDate = formatdate("YYYY-MM-DD", timestamp())
    }
  }
}
```

### 3.2 `locals` によるタグ管理

```hcl
# locals.tf
locals {
  # 共通タグ（default_tags を補完）
  common_tags = {
    Environment = var.environment
    CostCenter  = var.cost_center
    Owner       = var.owner
    Project     = var.project_name
    ManagedBy   = "terraform"
    CreatedDate = var.created_date
  }

  # リソース固有タグとマージ
  app_tags = merge(local.common_tags, {
    Application = "web-api"
    Team        = "app-team"
    Criticality = "high"
  })

  db_tags = merge(local.common_tags, {
    Application        = "database"
    DataClassification = "confidential"
    Criticality        = "high"
    SLA                = "99.99"
  })

  monitoring_tags = merge(local.common_tags, {
    Application = "monitoring"
    Team        = "platform-team"
  })
}
```

### 3.3 リソースへのタグ適用

```hcl
# ✅ GOOD: 共通タグ + リソース固有タグ
resource "azurerm_resource_group" "app" {
  name     = module.naming.names.resource_group
  location = var.location
  tags     = local.app_tags
}

resource "azurerm_mssql_server" "main" {
  name                = module.naming.names.sql_server
  resource_group_name = azurerm_resource_group.app.name
  location            = azurerm_resource_group.app.location
  version             = "12.0"
  tags                = local.db_tags

  # ...
}

# ❌ BAD: タグなし
resource "azurerm_resource_group" "bad_example" {
  name     = "rg-no-tags"
  location = "japaneast"
  # tags が設定されていない
}

# ❌ BAD: タグ値が標準化されていない
resource "azurerm_resource_group" "bad_tags" {
  name     = "rg-bad-tags"
  location = "japaneast"
  tags = {
    Environment = "Production"          # "prod" でなければならない
    "Cost Center" = "1001"              # スペースあり、形式違反
    owner = "Tanaka"                    # メールアドレスでない
    ManagedBy = "Terraform"             # 小文字でなければならない
  }
}
```

### 3.4 タグのバリデーション

```hcl
# variables.tf
variable "environment" {
  description = "デプロイ環境"
  type        = string

  validation {
    condition     = contains(["dev", "stg", "prod", "sandbox", "shared", "dr"], var.environment)
    error_message = "environment は dev, stg, prod, sandbox, shared, dr のいずれかを指定してください。"
  }
}

variable "cost_center" {
  description = "コストセンターコード"
  type        = string

  validation {
    condition     = can(regex("^CC-[0-9]{4}$", var.cost_center))
    error_message = "cost_center は CC-NNNN 形式で指定してください（例: CC-1001）。"
  }
}

variable "owner" {
  description = "責任者のメールアドレス"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$", var.owner))
    error_message = "owner は有効なメールアドレスで指定してください。"
  }
}

variable "project_name" {
  description = "プロジェクト名"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "project_name は小文字英数字とハイフンのみ使用可能です。"
  }
}
```

---

## 4. Azure Policy によるタグ強制

### 4.1 必須タグの強制（Deny）

```hcl
# 必須タグが欠落している場合、リソース作成を拒否する
resource "azurerm_policy_definition" "require_tags" {
  name         = "require-mandatory-tags"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "必須タグの強制"
  description  = "すべてのリソースに必須タグ（Environment, CostCenter, Owner, Project, ManagedBy）の付与を強制する。"

  metadata = jsonencode({
    category = "Tags"
    version  = "1.0.0"
  })

  parameters = jsonencode({
    tagName = {
      type = "String"
      metadata = {
        displayName = "タグ名"
        description = "必須のタグ名"
      }
    }
  })

  policy_rule = jsonencode({
    if = {
      field  = "[concat('tags[', parameters('tagName'), ']')]"
      exists = "false"
    }
    then = {
      effect = "deny"
    }
  })
}

# 各必須タグに対してポリシーを割り当て
locals {
  mandatory_tags = ["Environment", "CostCenter", "Owner", "Project", "ManagedBy"]
}

resource "azurerm_subscription_policy_assignment" "require_tag" {
  for_each = toset(local.mandatory_tags)

  name                 = "require-tag-${lower(each.key)}"
  policy_definition_id = azurerm_policy_definition.require_tags.id
  subscription_id      = data.azurerm_subscription.current.id
  display_name         = "必須タグ: ${each.key}"

  parameters = jsonencode({
    tagName = {
      value = each.key
    }
  })
}
```

### 4.2 リソースグループからのタグ継承

```hcl
# リソースグループのタグを子リソースに自動継承する
resource "azurerm_policy_definition" "inherit_tag_from_rg" {
  name         = "inherit-tag-from-resource-group"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "リソースグループからのタグ継承"
  description  = "リソースグループのタグ値を子リソースに自動継承する。"

  metadata = jsonencode({
    category = "Tags"
    version  = "1.0.0"
  })

  parameters = jsonencode({
    tagName = {
      type = "String"
      metadata = {
        displayName = "タグ名"
        description = "継承するタグ名"
      }
    }
  })

  policy_rule = jsonencode({
    if = {
      allOf = [
        {
          field  = "[concat('tags[', parameters('tagName'), ']')]"
          exists = "false"
        },
        {
          value  = "[resourceGroup().tags[parameters('tagName')]]"
          notEquals = ""
        }
      ]
    }
    then = {
      effect = "modify"
      details = {
        roleDefinitionIds = [
          "/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c"
        ]
        operations = [
          {
            operation = "addOrReplace"
            field     = "[concat('tags[', parameters('tagName'), ']')]"
            value     = "[resourceGroup().tags[parameters('tagName')]]"
          }
        ]
      }
    }
  })
}

resource "azurerm_subscription_policy_assignment" "inherit_environment" {
  name                 = "inherit-tag-environment"
  policy_definition_id = azurerm_policy_definition.inherit_tag_from_rg.id
  subscription_id      = data.azurerm_subscription.current.id
  display_name         = "タグ継承: Environment"
  location             = var.location

  parameters = jsonencode({
    tagName = {
      value = "Environment"
    }
  })

  identity {
    type = "SystemAssigned"
  }
}
```

### 4.3 タグ値のバリデーション（Azure Policy）

```hcl
# Environment タグの値を制限する
resource "azurerm_policy_definition" "validate_environment_tag" {
  name         = "validate-environment-tag-value"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "Environment タグ値のバリデーション"

  policy_rule = jsonencode({
    if = {
      allOf = [
        {
          field  = "tags['Environment']"
          exists = "true"
        },
        {
          field = "tags['Environment']"
          notIn = ["dev", "stg", "prod", "sandbox", "shared", "dr"]
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

## 5. コスト配賦

### 5.1 タグによるコスト分析

Azure Cost Management で以下のタグをディメンションとして使用する。

| タグ | コスト分析の用途 |
|------|----------------|
| `CostCenter` | 部門別コスト配賦 |
| `Project` | プロジェクト別コスト追跡 |
| `Environment` | 環境別コスト比較（dev vs prod） |
| `Application` | アプリケーション別コスト |
| `Team` | チーム別コスト |
| `Owner` | 責任者別コスト（説明責任） |

### 5.2 コストアラートとタグ

```hcl
# コストセンター別の予算アラート
resource "azurerm_consumption_budget_subscription" "cost_center" {
  for_each = var.cost_center_budgets

  name            = "budget-${each.key}"
  subscription_id = data.azurerm_subscription.current.id
  amount          = each.value.amount
  time_grain      = "Monthly"

  time_period {
    start_date = each.value.start_date
  }

  filter {
    tag {
      name   = "CostCenter"
      values = [each.key]
    }
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThanOrEqualTo"
    contact_emails = each.value.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    contact_emails = each.value.alert_emails
  }
}
```

---

## 6. タグのライフサイクル管理

### 6.1 `ExpiryDate` タグによる一時リソース管理

```hcl
# Sandbox リソースに有効期限を設定
resource "azurerm_resource_group" "sandbox" {
  name     = "rg-sandbox-experiment-001"
  location = "japaneast"

  tags = merge(local.common_tags, {
    Environment = "sandbox"
    ExpiryDate  = formatdate("YYYY-MM-DD", timeadd(timestamp(), "720h"))  # 30日後
    Purpose     = "poc-new-architecture"
  })
}

# Azure Automation で期限切れリソースを自動削除する Runbook と連携
```

### 6.2 `CreatedDate` の管理

```hcl
# ✅ GOOD: タグの初回設定後は変更しない
resource "azurerm_resource_group" "app" {
  name     = "rg-app"
  location = "japaneast"

  tags = merge(local.common_tags, {
    CreatedDate = var.created_date  # 変数で管理
  })

  lifecycle {
    ignore_changes = [
      tags["CreatedDate"],  # 既存リソースの CreatedDate は変更しない
    ]
  }
}
```

---

## 7. タグ対象外のリソース

以下のリソースタイプはタグをサポートしない。タグポリシーの除外対象として登録する。

| リソースタイプ | 備考 |
|---------------|------|
| `Microsoft.Network/virtualNetworks/subnets` | サブネットはタグ非対応 |
| `Microsoft.Network/networkSecurityGroups/securityRules` | NSG ルールはタグ非対応 |
| `Microsoft.Network/routeTables/routes` | ルートはタグ非対応 |
| `Microsoft.Authorization/roleAssignments` | ロール割り当てはタグ非対応 |
| `Microsoft.Authorization/policyAssignments` | ポリシー割り当てはタグ非対応 |

---

## チェックリスト

### リソース作成時
- [ ] 必須タグ（Environment, CostCenter, Owner, Project, ManagedBy, CreatedDate）を設定したか
- [ ] タグ値が標準化されたフォーマットに従っているか（小文字、ハイフン区切り）
- [ ] `Environment` タグが許可された値（dev/stg/prod/sandbox/shared/dr）か
- [ ] `CostCenter` が `CC-NNNN` 形式か
- [ ] `Owner` が有効なメールアドレスか
- [ ] `ManagedBy` が `terraform` に設定されているか

### Terraform 設定時
- [ ] `default_tags` または `locals` で共通タグを定義しているか
- [ ] リソース固有タグは `merge()` で共通タグとマージしているか
- [ ] 変数のバリデーション（`validation` ブロック）を設定したか
- [ ] `CreatedDate` に `ignore_changes` を設定したか

### Azure Policy 設定時
- [ ] 必須タグの Deny ポリシーを割り当てたか
- [ ] タグ継承ポリシー（リソースグループ → 子リソース）を設定したか
- [ ] Environment タグ値のバリデーションポリシーを設定したか
- [ ] タグ非対応リソースを除外設定したか

### コスト管理時
- [ ] CostCenter タグでコスト配賦が正しく行われているか
- [ ] Project タグでプロジェクト別コストが追跡できるか
- [ ] コストセンター別の予算アラートを設定したか
