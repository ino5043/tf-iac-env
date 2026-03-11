# Terraform Scaffold スキル

Terraform プロジェクトおよびモジュールのスキャフォールディングを自動生成するスキル。
Azure 環境を前提とし、ベストプラクティスに沿ったディレクトリ構成とファイルを生成する。

---

## トリガー

以下のいずれかに該当する場合にこのスキルを使用する。

- 新しい Terraform プロジェクトを作成する
- 新しい Terraform モジュールを追加する
- 環境別（dev/staging/prod）の構成を生成する

---

## 新規プロジェクト テンプレート

### ディレクトリ構成

```
project-root/
├── .gitignore
├── .terraform-version
├── Makefile
├── README.md
├── backend.tf
├── provider.tf
├── variables.tf
├── outputs.tf
├── main.tf
├── locals.tf
├── data.tf
├── versions.tf
├── environments/
│   ├── dev/
│   │   ├── terraform.tfvars
│   │   └── backend.hcl
│   ├── staging/
│   │   ├── terraform.tfvars
│   │   └── backend.hcl
│   └── prod/
│       ├── terraform.tfvars
│       └── backend.hcl
└── modules/
    └── (プロジェクト固有モジュール)
```

### versions.tf

```hcl
terraform {
  required_version = ">= 1.9.0"

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
```

### provider.tf

```hcl
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
    virtual_machine {
      delete_os_disk_on_deletion     = true
      graceful_shutdown              = true
      skip_shutdown_and_force_delete  = false
    }
  }

  subscription_id = var.subscription_id
}

provider "azuread" {}
```

### backend.tf

```hcl
terraform {
  backend "azurerm" {
    # 環境別の backend.hcl で上書きする
    # terraform init -backend-config=environments/dev/backend.hcl
  }
}
```

### environments/dev/backend.hcl

```hcl
resource_group_name  = "rg-tfstate-dev"
storage_account_name = "sttfstatedev"
container_name       = "tfstate"
key                  = "project-name.terraform.tfstate"
```

### environments/dev/terraform.tfvars

```hcl
environment     = "dev"
location        = "japaneast"
subscription_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

tags = {
  Environment = "dev"
  Project     = "project-name"
  ManagedBy   = "terraform"
}
```

### variables.tf

```hcl
variable "environment" {
  description = "デプロイ先環境（dev, staging, prod）"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment は dev, staging, prod のいずれかを指定してください。"
  }
}

variable "location" {
  description = "Azure リージョン"
  type        = string
  default     = "japaneast"
}

variable "subscription_id" {
  description = "Azure Subscription ID"
  type        = string
}

variable "tags" {
  description = "全リソースに付与する共通タグ"
  type        = map(string)
  default     = {}
}
```

### locals.tf

```hcl
locals {
  # 命名規則: {リソース種別}-{プロジェクト名}-{環境}
  name_prefix = "project-${var.environment}"

  common_tags = merge(var.tags, {
    Environment = var.environment
    ManagedBy   = "terraform"
    LastApplied = timestamp()
  })
}
```

### Makefile

```makefile
ENV ?= dev
PLAN_FILE = tfplan-$(ENV)

.PHONY: init plan apply destroy fmt validate lint

init:
	terraform init -backend-config=environments/$(ENV)/backend.hcl -reconfigure

plan: init
	terraform plan -var-file=environments/$(ENV)/terraform.tfvars -out=$(PLAN_FILE)

apply:
	terraform apply $(PLAN_FILE)

destroy: init
	terraform plan -destroy -var-file=environments/$(ENV)/terraform.tfvars -out=$(PLAN_FILE)-destroy
	terraform apply $(PLAN_FILE)-destroy

fmt:
	terraform fmt -recursive

validate: init
	terraform validate

lint:
	tflint --init
	tflint --var-file=environments/$(ENV)/terraform.tfvars
```

### .gitignore

```
# Terraform
.terraform/
*.tfstate
*.tfstate.*
*.tfplan
tfplan-*
crash.log
crash.*.log
override.tf
override.tf.json
*_override.tf
*_override.tf.json
.terraformrc
terraform.rc

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Sensitive
*.auto.tfvars
secrets.tfvars
```

### .terraform-version

```
1.9.8
```

---

## 新規モジュール テンプレート

### ディレクトリ構成

```
modules/module-name/
├── README.md
├── main.tf
├── variables.tf
├── outputs.tf
├── locals.tf
├── versions.tf
└── examples/
    └── basic/
        └── main.tf
```

### modules/module-name/variables.tf

```hcl
variable "name" {
  description = "リソース名"
  type        = string
}

variable "location" {
  description = "Azure リージョン"
  type        = string
}

variable "resource_group_name" {
  description = "リソースグループ名"
  type        = string
}

variable "tags" {
  description = "リソースタグ"
  type        = map(string)
  default     = {}
}
```

### modules/module-name/outputs.tf

```hcl
output "id" {
  description = "リソース ID"
  value       = azurerm_xxx.this.id
}

output "name" {
  description = "リソース名"
  value       = azurerm_xxx.this.name
}
```

---

## 実行手順

1. プロジェクト種別（新規プロジェクト / 新規モジュール）を確認する
2. プロジェクト名、対象 Azure リージョン、サブスクリプション情報を収集する
3. テンプレートに基づいてファイルを生成する
4. `terraform fmt` で整形する
5. `terraform validate` で構文検証する

---

## 命名規則

| リソース種別 | プレフィックス | 例 |
|-------------|--------------|-----|
| Resource Group | `rg-` | `rg-myapp-dev` |
| Virtual Network | `vnet-` | `vnet-hub-japaneast` |
| Subnet | `snet-` | `snet-app-001` |
| Network Security Group | `nsg-` | `nsg-web-001` |
| Storage Account | `st` | `stmyappdev` |
| Key Vault | `kv-` | `kv-myapp-dev` |
| App Service | `app-` | `app-myapp-dev` |
| Container Apps | `ca-` | `ca-myapp-dev` |
| Log Analytics | `log-` | `log-myapp-dev` |
| Application Insights | `appi-` | `appi-myapp-dev` |

※ [Azure 命名規則ガイダンス](https://learn.microsoft.com/ja-jp/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming) に準拠する。

---

## チェックリスト

- [ ] `versions.tf` で Terraform と Provider のバージョンを固定したか
- [ ] `backend.tf` でリモート State を設定したか
- [ ] 環境別 `terraform.tfvars` に適切な値を設定したか
- [ ] `.gitignore` に機密ファイルを含めたか
- [ ] 変数に `description` と `validation` を記載したか
- [ ] 命名規則に従っているか
- [ ] `terraform fmt` と `terraform validate` を実行したか
