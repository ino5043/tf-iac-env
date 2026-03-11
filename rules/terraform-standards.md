# Terraform コーディング規約

Terraform による IaC 開発の必須ルール。コードの一貫性、可読性、保守性を確保する。

---

## 1. バージョン管理

### 1.1 Terraform バージョンの固定

すべてのルートモジュールで `required_version` を指定する。パッチバージョンまでは許容する。

```hcl
# ✅ GOOD: 適切なバージョン制約
terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
}

# ❌ BAD: バージョン制約なし
terraform {
  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
    }
  }
}
```

### 1.2 バージョン制約演算子

| 演算子 | 意味 | 用途 |
|--------|------|------|
| `= 1.9.0` | 完全固定 | 再現性が最優先の場合 |
| `~> 4.0` | `>= 4.0, < 5.0` | Provider バージョン制約（推奨） |
| `~> 4.0.0` | `>= 4.0.0, < 4.1.0` | マイナーバージョン固定 |
| `>= 1.9.0, < 2.0.0` | 範囲指定 | Terraform 本体のバージョン制約（推奨） |

### 1.3 `.terraform.lock.hcl`

- **必ずリポジトリにコミットする**（`.gitignore` に含めない）
- `terraform init -upgrade` で明示的に更新する
- CI/CD パイプラインで `terraform init` が一貫した Provider バージョンを使用することを保証する

---

## 2. モジュール構造

### 2.1 ルートモジュールの標準構成

```
environments/
├── dev/
│   ├── main.tf          # モジュール呼び出し、リソース定義
│   ├── variables.tf     # 入力変数定義
│   ├── outputs.tf       # 出力値定義
│   ├── providers.tf     # Provider 設定
│   ├── backend.tf       # State バックエンド設定
│   ├── locals.tf        # ローカル値
│   ├── data.tf          # Data Source
│   └── terraform.tfvars # 環境固有の値
├── stg/
│   └── (同構成)
└── prod/
    └── (同構成)

modules/
├── networking/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── README.md
├── compute/
└── security/
```

### 2.2 ファイル分割の方針

| ファイル | 内容 | 備考 |
|----------|------|------|
| `main.tf` | リソース定義、モジュール呼び出し | 200行を超えたらリソース種別で分割 |
| `variables.tf` | すべての `variable` ブロック | description 必須 |
| `outputs.tf` | すべての `output` ブロック | description 必須 |
| `providers.tf` | `terraform` ブロック、`provider` ブロック | ルートモジュールのみ |
| `backend.tf` | `backend` 設定 | ルートモジュールのみ |
| `locals.tf` | `locals` ブロック | 共通の計算値・マッピング |
| `data.tf` | すべての `data` ソース | 外部参照をまとめる |
| `versions.tf` | `required_providers` のみ（子モジュール用） | 子モジュールで使用 |

### 2.3 子モジュール設計原則

```hcl
# ✅ GOOD: 明確なインターフェースを持つ子モジュール
# modules/networking/variables.tf
variable "vnet_name" {
  description = "仮想ネットワークの名前"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.vnet_name))
    error_message = "VNet 名は小文字英数字とハイフンのみ使用可能です。"
  }
}

variable "address_space" {
  description = "VNet のアドレス空間（CIDR 表記）"
  type        = list(string)

  validation {
    condition     = alltrue([for cidr in var.address_space : can(cidrhost(cidr, 0))])
    error_message = "有効な CIDR 表記で指定してください。"
  }
}

variable "subnets" {
  description = "サブネット定義のマップ"
  type = map(object({
    address_prefixes = list(string)
    delegation       = optional(string)
    nsg_id           = optional(string)
  }))
}

# modules/networking/outputs.tf
output "vnet_id" {
  description = "作成された VNet のリソース ID"
  value       = azurerm_virtual_network.this.id
}

output "subnet_ids" {
  description = "サブネット名と ID のマップ"
  value       = { for k, v in azurerm_subnet.this : k => v.id }
}
```

---

## 3. 命名規約

### 3.1 Terraform 内部の命名

| 対象 | 規約 | 例 |
|------|------|-----|
| リソース名（HCL 内部） | `snake_case` | `azurerm_resource_group.main` |
| 変数名 | `snake_case` | `var.resource_group_name` |
| ローカル値 | `snake_case` | `local.common_tags` |
| 出力値 | `snake_case` | `output.vnet_id` |
| モジュール名 | `snake_case` | `module.networking` |
| ファイル名 | `snake_case` + `.tf` | `network_security_group.tf` |

### 3.2 リソースの論理名

```hcl
# ✅ GOOD: 意味のある論理名
resource "azurerm_resource_group" "main" { ... }
resource "azurerm_resource_group" "networking" { ... }
resource "azurerm_virtual_network" "hub" { ... }
resource "azurerm_subnet" "app" { ... }
resource "azurerm_subnet" "db" { ... }

# ❌ BAD: 無意味な論理名
resource "azurerm_resource_group" "rg1" { ... }
resource "azurerm_resource_group" "this" { ... }  # 子モジュールでは OK
resource "azurerm_virtual_network" "vnet" { ... }  # リソース種別の繰り返し
```

**例外**: 子モジュール内で単一リソースの場合は `this` を使用してよい。

```hcl
# modules/resource_group/main.tf
# 子モジュール内の単一リソースは "this" が慣例
resource "azurerm_resource_group" "this" {
  name     = var.name
  location = var.location
  tags     = var.tags
}
```

### 3.3 変数の命名パターン

```hcl
# ✅ GOOD: 明確で一貫した変数名
variable "resource_group_name" {
  description = "リソースグループ名"
  type        = string
}

variable "location" {
  description = "Azure リージョン"
  type        = string
  default     = "japaneast"
}

variable "enable_diagnostics" {
  description = "診断設定を有効にするかどうか"
  type        = bool
  default     = true
}

variable "sku_name" {
  description = "SKU の名前"
  type        = string
}

# ❌ BAD: 曖昧・省略・不統一
variable "rg" { ... }        # 省略しすぎ
variable "loc" { ... }       # 省略しすぎ
variable "flag1" { ... }     # 何のフラグか不明
variable "RGName" { ... }    # PascalCase は禁止
```

---

## 4. 変数定義のルール

### 4.1 必須属性

すべての `variable` ブロックに以下を含める。

```hcl
variable "environment" {
  description = "デプロイ環境（dev, stg, prod）"  # 必須
  type        = string                              # 必須

  validation {                                       # 推奨
    condition     = contains(["dev", "stg", "prod"], var.environment)
    error_message = "environment は dev, stg, prod のいずれかを指定してください。"
  }
}

variable "instance_count" {
  description = "インスタンス数"
  type        = number
  default     = 1  # デフォルト値がある場合のみ

  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 10
    error_message = "instance_count は 1 以上 10 以下で指定してください。"
  }
}
```

### 4.2 sensitive 変数

```hcl
# パスワード、APIキーなどは sensitive = true を設定
variable "admin_password" {
  description = "管理者パスワード"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.admin_password) >= 16
    error_message = "パスワードは16文字以上で指定してください。"
  }
}
```

---

## 5. ベストプラクティス

### 5.1 `count` vs `for_each`

```hcl
# ❌ BAD: count はインデックスで管理されるため、順序変更でリソース再作成
resource "azurerm_subnet" "this" {
  count = length(var.subnet_names)
  name  = var.subnet_names[count.index]
  # ...
}

# ✅ GOOD: for_each はキーで管理されるため、安全に追加・削除可能
resource "azurerm_subnet" "this" {
  for_each = var.subnets

  name                 = each.key
  resource_group_name  = azurerm_virtual_network.this.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = each.value.address_prefixes
}
```

### 5.2 `count` の適切な使い方

`count` はリソースの有無を切り替える場合にのみ使用する。

```hcl
# ✅ GOOD: 条件付きリソース作成
resource "azurerm_monitor_diagnostic_setting" "this" {
  count = var.enable_diagnostics ? 1 : 0

  name               = "${var.name}-diag"
  target_resource_id = azurerm_key_vault.this.id
  # ...
}
```

### 5.3 データソースの活用

```hcl
# ✅ GOOD: 既存リソースの参照にはデータソースを使う
data "azurerm_client_config" "current" {}
data "azurerm_subscription" "current" {}

data "azurerm_resource_group" "existing" {
  name = "rg-shared-resources"
}

# ❌ BAD: ハードコードされた ID
resource "azurerm_role_assignment" "this" {
  scope                = "/subscriptions/12345678-1234-1234-1234-123456789012"
  role_definition_name = "Contributor"
  principal_id         = "abcdefgh-1234-5678-9012-123456789012"
}

# ✅ GOOD: データソースで動的に取得
resource "azurerm_role_assignment" "this" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.this.principal_id
}
```

### 5.4 `depends_on` の使用制限

```hcl
# ❌ BAD: 不要な depends_on（暗黙的依存で十分）
resource "azurerm_subnet" "app" {
  # ...
  virtual_network_name = azurerm_virtual_network.this.name  # 暗黙的依存
  depends_on           = [azurerm_virtual_network.this]       # 冗長
}

# ✅ GOOD: 暗黙的依存で解決できない場合のみ使用
resource "azurerm_subnet_network_security_group_association" "app" {
  subnet_id                 = azurerm_subnet.app.id
  network_security_group_id = azurerm_network_security_group.app.id

  depends_on = [
    azurerm_subnet_route_table_association.app  # 暗黙的に検出できない依存
  ]
}
```

### 5.5 `lifecycle` ブロック

```hcl
resource "azurerm_key_vault" "this" {
  name                = local.key_vault_name
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku_name            = "standard"
  tenant_id           = data.azurerm_client_config.current.tenant_id

  lifecycle {
    prevent_destroy = true  # 本番環境では削除防止
  }
}

resource "azurerm_storage_account" "this" {
  name                     = local.storage_account_name
  resource_group_name      = azurerm_resource_group.this.name
  location                 = azurerm_resource_group.this.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  lifecycle {
    ignore_changes = [
      tags["UpdatedAt"],  # 外部プロセスが更新するタグを無視
    ]
  }
}
```

---

## 6. コードフォーマット

### 6.1 `terraform fmt`

すべてのコードは `terraform fmt` でフォーマットする。CI/CD で `terraform fmt -check` を実行する。

```bash
# ローカル開発
terraform fmt -recursive

# CI/CD チェック
terraform fmt -check -recursive -diff
```

### 6.2 `terraform validate`

```bash
# 構文チェック
terraform init -backend=false
terraform validate
```

### 6.3 静的解析ツール

| ツール | 用途 | 推奨 |
|--------|------|------|
| `tflint` | Terraform 固有のリント | 必須 |
| `tfsec` / `trivy` | セキュリティスキャン | 必須 |
| `checkov` | コンプライアンスチェック | 推奨 |
| `terraform-docs` | ドキュメント自動生成 | 推奨 |
| `infracost` | コスト見積もり | 推奨 |

---

## 7. State 管理の基本

### 7.1 リモートバックエンド（必須）

ローカル State の使用は禁止する。Azure Storage Backend を使用する。

```hcl
# backend.tf
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "stterraformstate001"
    container_name       = "tfstate"
    key                  = "dev/networking.tfstate"
    use_azuread_auth     = true
  }
}
```

### 7.2 State ロック

Azure Storage Backend は Blob Lease によるロックを自動で行う。手動ロック解除が必要な場合は `terraform force-unlock` を使用する（要慎重）。

---

## 8. 出力値のルール

```hcl
# ✅ GOOD: 必要な情報を適切な粒度で出力
output "resource_group_id" {
  description = "リソースグループの ID"
  value       = azurerm_resource_group.this.id
}

output "resource_group_name" {
  description = "リソースグループの名前"
  value       = azurerm_resource_group.this.name
}

# sensitive な出力
output "connection_string" {
  description = "データベース接続文字列"
  value       = azurerm_mssql_database.this.connection_string
  sensitive   = true
}

# ❌ BAD: リソース全体を出力
output "resource_group" {
  value = azurerm_resource_group.this  # 不要な情報が漏洩する可能性
}
```

---

## 9. ローカル値の活用

```hcl
# locals.tf
locals {
  # 共通タグ
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
    Owner       = var.owner
  }

  # 命名規約に基づくリソース名生成
  name_prefix = "${var.org}-${var.environment}-${var.region_code}"

  # 条件分岐
  is_production = var.environment == "prod"

  # サブネット CIDR の計算
  subnet_cidrs = {
    app = cidrsubnet(var.vnet_address_space[0], 8, 1)
    db  = cidrsubnet(var.vnet_address_space[0], 8, 2)
    gw  = cidrsubnet(var.vnet_address_space[0], 8, 3)
  }
}
```

---

## チェックリスト

### コード作成時
- [ ] `required_version` と `required_providers` にバージョン制約を設定したか
- [ ] `.terraform.lock.hcl` をリポジトリにコミットしているか
- [ ] すべての `variable` に `description` と `type` を設定したか
- [ ] 入力値のバリデーション（`validation` ブロック）を追加したか
- [ ] `snake_case` で命名しているか
- [ ] `count` ではなく `for_each` を使用しているか（リスト反復の場合）
- [ ] ハードコードされた ID・値がないか
- [ ] `sensitive` 変数に `sensitive = true` を設定したか

### レビュー時
- [ ] `terraform fmt` が適用されているか
- [ ] `terraform validate` がパスするか
- [ ] `tflint` / `tfsec` の指摘事項を対応したか
- [ ] 不要な `depends_on` がないか
- [ ] 本番リソースに `prevent_destroy` が設定されているか
- [ ] 出力値に不要な情報が含まれていないか
- [ ] ローカル State を使用していないか

### CI/CD パイプライン
- [ ] `terraform fmt -check` を実行しているか
- [ ] `terraform validate` を実行しているか
- [ ] `tflint` を実行しているか
- [ ] セキュリティスキャン（tfsec / trivy）を実行しているか
- [ ] `terraform plan` の出力をレビューしているか
- [ ] `terraform apply` は承認後にのみ実行されるか
