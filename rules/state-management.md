# Terraform State 管理規約

Terraform State の保管・分割・運用に関する必須ルール。リモートバックエンド、State 分割戦略、災害復旧に適用する。

---

## 1. State 基礎

### 1.1 なぜリモート State が必須か

| ローカル State の問題 | リモート State の利点 |
|---------------------|---------------------|
| チーム共有不可 | 共有ストレージで全員がアクセス |
| ロックなし（同時実行で破損） | State ロック（排他制御） |
| 暗号化なし | Server-Side Encryption |
| バックアップなし | バージョニング・バックアップ |
| CI/CD 連携困難 | パイプラインから直接アクセス |

**原則**: ローカル State の使用は禁止する。すべての環境でリモートバックエンドを使用する。

### 1.2 Azure Storage Backend

```hcl
# backend.tf
terraform {
  backend "azurerm" {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "stterraformstate001"
    container_name       = "tfstate"
    key                  = "prod/networking.tfstate"
    use_azuread_auth     = true  # Managed Identity / Entra ID 認証
  }
}
```

---

## 2. State バックエンド基盤の構築

### 2.1 Storage Account の要件

| 設定項目 | 値 | 理由 |
|---------|-----|------|
| レプリケーション | `GRS`（Geo 冗長） | 災害復旧 |
| アクセスティア | `Hot` | 頻繁なアクセス |
| Blob バージョニング | 有効 | State 履歴の保持 |
| Soft Delete | 有効（14 日） | 誤削除防止 |
| パブリックアクセス | 無効 | Private Endpoint のみ |
| 暗号化 | Microsoft マネージドキー | デフォルト有効 |
| ネットワーク制限 | 信頼された Azure サービス + CI/CD IP | 最小限のアクセス |
| RBAC | `Storage Blob Data Contributor` | アクセスキー不使用 |

### 2.2 Terraform による State 基盤構築

State 基盤自体は Terraform で管理する（鶏と卵問題のため、初回のみローカル State → リモートに移行）。

```hcl
# state-infra/main.tf
# State 管理用インフラストラクチャ（Bootstrap 用）
resource "azurerm_resource_group" "state" {
  name     = "rg-terraform-state"
  location = "japaneast"

  tags = {
    Environment = "shared"
    ManagedBy   = "terraform-bootstrap"
    Purpose     = "terraform-state-storage"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_account" "state" {
  name                          = "stterraformstate001"
  resource_group_name           = azurerm_resource_group.state.name
  location                      = azurerm_resource_group.state.location
  account_tier                  = "Standard"
  account_replication_type      = "GRS"
  min_tls_version               = "TLS1_2"
  public_network_access_enabled = false
  allow_nested_items_to_be_public = false

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 14
    }

    container_delete_retention_policy {
      days = 14
    }
  }

  tags = azurerm_resource_group.state.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
}

# Lock: State 基盤を誤削除から保護
resource "azurerm_management_lock" "state_rg" {
  name       = "lock-terraform-state"
  scope      = azurerm_resource_group.state.id
  lock_level = "CanNotDelete"
  notes      = "Terraform State 基盤。削除禁止。"
}

resource "azurerm_management_lock" "state_storage" {
  name       = "lock-state-storage"
  scope      = azurerm_storage_account.state.id
  lock_level = "CanNotDelete"
  notes      = "Terraform State Storage Account。削除禁止。"
}

# RBAC: Terraform 実行者に Blob Data Contributor を付与
resource "azurerm_role_assignment" "state_contributor" {
  for_each = var.terraform_executor_principal_ids

  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.value
}
```

### 2.3 Bootstrap 手順

```bash
# 1. State 基盤をローカル State で初期構築
cd state-infra/
terraform init
terraform apply

# 2. ローカル State をリモートに移行
# backend.tf を追加してから:
terraform init -migrate-state

# 3. ローカル State ファイルを削除
rm terraform.tfstate terraform.tfstate.backup
```

---

## 3. State 分割戦略

### 3.1 分割の原則

| 分割軸 | 用途 | 例 |
|--------|------|-----|
| 環境別 | 環境間の独立性 | `dev/`, `stg/`, `prod/` |
| レイヤー別 | 変更頻度・責任の分離 | `networking/`, `security/`, `compute/` |
| コンポーネント別 | 大規模環境での管理 | `aks/`, `database/`, `monitoring/` |

### 3.2 推奨 State 構成

```
tfstate コンテナ内の構成:

tfstate/
├── shared/
│   ├── networking-hub.tfstate      # Hub VNet, Firewall, VPN
│   ├── dns.tfstate                  # Private DNS Zones
│   └── monitoring.tfstate           # Log Analytics, Action Groups
├── dev/
│   ├── networking.tfstate           # Spoke VNet, NSG, Peering
│   ├── security.tfstate             # Key Vault, RBAC
│   ├── compute.tfstate              # App Service, AKS
│   └── data.tfstate                 # SQL, Storage
├── stg/
│   ├── networking.tfstate
│   ├── security.tfstate
│   ├── compute.tfstate
│   └── data.tfstate
└── prod/
    ├── networking.tfstate
    ├── security.tfstate
    ├── compute.tfstate
    └── data.tfstate
```

### 3.3 レイヤー間の依存関係

```
Layer 1: Networking（変更頻度: 低）
    │
    ▼ terraform_remote_state
Layer 2: Security（変更頻度: 低-中）
    │
    ▼ terraform_remote_state
Layer 3: Data（変更頻度: 中）
    │
    ▼ terraform_remote_state
Layer 4: Compute（変更頻度: 高）
    │
    ▼ terraform_remote_state
Layer 5: Application Config（変更頻度: 高）
```

### 3.4 `terraform_remote_state` によるレイヤー間参照

```hcl
# compute/data.tf
# Networking レイヤーの出力を参照
data "terraform_remote_state" "networking" {
  backend = "azurerm"

  config = {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "stterraformstate001"
    container_name       = "tfstate"
    key                  = "${var.environment}/networking.tfstate"
    use_azuread_auth     = true
  }
}

# Security レイヤーの出力を参照
data "terraform_remote_state" "security" {
  backend = "azurerm"

  config = {
    resource_group_name  = "rg-terraform-state"
    storage_account_name = "stterraformstate001"
    container_name       = "tfstate"
    key                  = "${var.environment}/security.tfstate"
    use_azuread_auth     = true
  }
}

# compute/main.tf
resource "azurerm_linux_web_app" "api" {
  name                = var.app_service_name
  resource_group_name = var.resource_group_name
  location            = var.location
  service_plan_id     = azurerm_service_plan.main.id

  # Networking レイヤーの出力値を使用
  virtual_network_subnet_id = data.terraform_remote_state.networking.outputs.app_subnet_id

  # Security レイヤーの出力値を使用
  identity {
    type         = "UserAssigned"
    identity_ids = [data.terraform_remote_state.security.outputs.app_identity_id]
  }

  # ...
}
```

---

## 4. Workspace 戦略

### 4.1 Workspace vs 分離 State

| 項目 | Workspace | 分離 State ファイル |
|------|-----------|-------------------|
| 環境分離 | 同一コード + workspace で切替 | ディレクトリで完全分離 |
| 設定の違い | `terraform.workspace` で条件分岐 | `.tfvars` で環境固有値 |
| 誤操作リスク | workspace の切り替え忘れ | 低い（ディレクトリ移動が明確） |
| CI/CD 統合 | `terraform workspace select` が必要 | ディレクトリ指定のみ |
| **推奨** | **小規模・同一構成の環境** | **本番推奨（環境間差異がある場合）** |

### 4.2 Workspace 使用例（小規模環境）

```hcl
# main.tf
locals {
  environment = terraform.workspace

  config = {
    dev = {
      instance_count = 1
      sku            = "B1"
    }
    stg = {
      instance_count = 2
      sku            = "S1"
    }
    prod = {
      instance_count = 3
      sku            = "P1v3"
    }
  }

  current_config = local.config[local.environment]
}
```

```bash
# Workspace の使用
terraform workspace new dev
terraform workspace new stg
terraform workspace new prod

terraform workspace select prod
terraform plan
terraform apply
```

### 4.3 分離 State（推奨: 環境間差異がある場合）

```
environments/
├── dev/
│   ├── main.tf
│   ├── backend.tf    # key = "dev/main.tfstate"
│   └── terraform.tfvars
├── stg/
│   ├── main.tf
│   ├── backend.tf    # key = "stg/main.tfstate"
│   └── terraform.tfvars
└── prod/
    ├── main.tf
    ├── backend.tf    # key = "prod/main.tfstate"
    └── terraform.tfvars
```

---

## 5. State 操作

### 5.1 操作の危険度と注意事項

| 操作 | コマンド | 危険度 | 用途 |
|------|---------|--------|------|
| State の確認 | `terraform state list` | 低 | リソース一覧の確認 |
| State の詳細確認 | `terraform state show <resource>` | 低 | リソースの詳細属性確認 |
| リソースの Import | `terraform import <resource> <id>` | 中 | 既存リソースの取り込み |
| リソースの移動 | `terraform state mv` | 高 | リファクタリング時 |
| リソースの除外 | `terraform state rm` | 高 | State からの除外（リソースは残る） |
| taint（再作成） | `terraform taint` (deprecated) | 高 | `-replace` を使用する |
| State のリフレッシュ | `terraform refresh` (deprecated) | 中 | `terraform apply -refresh-only` を使用する |
| ロックの強制解除 | `terraform force-unlock <id>` | 高 | ロック残留時のみ |

### 5.2 Import（推奨: import ブロック）

```hcl
# ✅ GOOD: import ブロック（Terraform 1.5+）
import {
  to = azurerm_resource_group.existing
  id = "/subscriptions/xxx/resourceGroups/rg-existing"
}

resource "azurerm_resource_group" "existing" {
  name     = "rg-existing"
  location = "japaneast"
  tags     = local.common_tags
}

# terraform plan で差分を確認してから apply
```

```bash
# 従来の import コマンド
terraform import azurerm_resource_group.existing \
  "/subscriptions/xxx/resourceGroups/rg-existing"
```

### 5.3 State 移動（リファクタリング時）

```hcl
# ✅ GOOD: moved ブロック（Terraform 1.1+）
# リソース名の変更時に State の連続性を維持
moved {
  from = azurerm_resource_group.main
  to   = azurerm_resource_group.app
}

resource "azurerm_resource_group" "app" {
  name     = "rg-app"
  location = "japaneast"
}
```

```bash
# 従来の state mv コマンド
terraform state mv azurerm_resource_group.main azurerm_resource_group.app
```

### 5.4 操作前の安全確認

```bash
# State 操作前に必ずバックアップを取得
terraform state pull > state-backup-$(date +%Y%m%d-%H%M%S).tfstate

# 操作後に plan で差分がないことを確認
terraform plan
# "No changes" が出ることを確認
```

---

## 6. 災害復旧

### 6.1 State のバックアップ戦略

| 方法 | 設定 | 復旧時間 |
|------|------|---------|
| Blob バージョニング | 自動（有効化済み） | 分単位 |
| GRS レプリケーション | 自動 | 時間単位 |
| 手動バックアップ | `terraform state pull` | 即時 |
| Azure Backup | Blob バックアップポリシー | 日単位 |

### 6.2 State 復旧手順

```bash
# 1. 最新の State をダウンロード（正常な場合）
terraform state pull > current-state.tfstate

# 2. Blob バージョンから復元（Azure Portal / CLI）
az storage blob download \
  --account-name stterraformstate001 \
  --container-name tfstate \
  --name prod/networking.tfstate \
  --file recovered-state.tfstate \
  --version-id "2026-03-11T10:00:00.0000000Z"

# 3. 復元した State をアップロード
terraform state push recovered-state.tfstate

# 4. State とリソースの整合性を確認
terraform plan
# "No changes" になることを確認
```

### 6.3 State ファイル完全喪失時

```bash
# すべてのリソースを再 Import する必要がある
# 1. リソース ID をリストアップ（Azure Portal / CLI）
az resource list --resource-group rg-prod-app-001 --output table

# 2. import ブロックを作成
# 3. terraform plan で差分を確認
# 4. terraform apply で State を再構築

# 注意: 完全復旧には時間がかかるため、バックアップは必須
```

---

## 7. CI/CD 統合

### 7.1 State ロックとパイプライン

```yaml
# GitHub Actions での Terraform パイプライン
name: Terraform Plan & Apply

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  id-token: write  # OIDC 認証
  contents: read
  pull-requests: write

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.9.x"

      - name: Terraform Init
        run: terraform init
        working-directory: environments/prod

      - name: Terraform Plan
        run: terraform plan -out=tfplan -lock=true
        working-directory: environments/prod

      # Plan 結果を PR にコメント
      - name: Post Plan to PR
        if: github.event_name == 'pull_request'
        uses: borchero/terraform-plan-comment@v2
        with:
          working-directory: environments/prod

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    environment: production  # 承認ゲート
    steps:
      - uses: actions/checkout@v4

      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        run: terraform init
        working-directory: environments/prod

      - name: Terraform Apply
        run: terraform apply -auto-approve -lock=true
        working-directory: environments/prod
```

### 7.2 ロック残留時の対処

```bash
# ロック情報を確認
terraform plan
# Error: Error locking state: Error acquiring the state lock

# ロック ID を確認してから強制解除（要慎重）
terraform force-unlock <LOCK_ID>

# 注意: 他のユーザー/パイプラインが実行中でないことを必ず確認する
```

---

## チェックリスト

### State 基盤構築時
- [ ] Azure Storage Account を GRS で作成したか
- [ ] Blob バージョニングを有効化したか
- [ ] Soft Delete を有効化したか（14 日以上）
- [ ] パブリックアクセスを無効化したか
- [ ] RBAC（`Storage Blob Data Contributor`）で認可しているか（アクセスキー不使用）
- [ ] Management Lock で誤削除を防止したか
- [ ] `use_azuread_auth = true` を設定したか

### State 分割時
- [ ] 環境別に State を分離したか
- [ ] レイヤー別に State を分割したか（変更頻度に基づく）
- [ ] `terraform_remote_state` でレイヤー間参照を設定したか
- [ ] 循環参照がないか確認したか

### State 操作時
- [ ] 操作前にバックアップ（`terraform state pull`）を取得したか
- [ ] 操作後に `terraform plan` で "No changes" を確認したか
- [ ] `moved` ブロック（1.1+）/ `import` ブロック（1.5+）を使用しているか
- [ ] `force-unlock` は他の実行が存在しないことを確認してから使用したか

### CI/CD 統合時
- [ ] State ロック（`-lock=true`）を有効にしているか
- [ ] OIDC 認証（Workload Identity Federation）を使用しているか
- [ ] Plan 結果を PR にコメントしているか
- [ ] Apply は承認ゲート付きの environment で実行しているか
