# Azure リソース命名規約

Azure Cloud Adoption Framework (CAF) に準拠したリソース命名の必須ルール。すべての Azure リソースに適用する。

---

## 1. 命名パターン

### 1.1 標準フォーマット

```
<org>-<env>-<region>-<resource_type>-<workload>-<instance>
```

| セグメント | 説明 | 例 |
|-----------|------|-----|
| `org` | 組織コード（2-4文字） | `tf`, `contoso` |
| `env` | 環境コード | `dev`, `stg`, `prod` |
| `region` | リージョンコード | `jpe`, `jpw`, `eus2` |
| `resource_type` | リソース種別の略称 | `rg`, `vnet`, `kv` |
| `workload` | ワークロード・用途 | `app`, `shared`, `hub` |
| `instance` | インスタンス番号（省略可） | `001`, `01` |

### 1.2 命名例

```
tf-prod-jpe-rg-networking-001      # リソースグループ
tf-prod-jpe-vnet-hub-001           # 仮想ネットワーク
tf-prod-jpe-snet-app-001           # サブネット
tf-prod-jpe-nsg-app-001            # ネットワークセキュリティグループ
tf-prod-jpe-kv-app-001             # Key Vault
tf-prod-jpe-app-api-001            # App Service
```

---

## 2. 環境コード

| コード | 環境 | 用途 |
|--------|------|------|
| `dev` | 開発 | 開発者の日常作業 |
| `stg` | ステージング | リリース前の検証 |
| `prod` | 本番 | 本番稼働環境 |
| `sandbox` | サンドボックス | 実験・PoC |
| `shared` | 共有 | 全環境で共有するリソース |

---

## 3. リージョンコード

| コード | Azure リージョン | 用途 |
|--------|-----------------|------|
| `jpe` | Japan East（東日本） | プライマリリージョン |
| `jpw` | Japan West（西日本） | DR リージョン |
| `eus2` | East US 2 | グローバル展開時 |
| `weu` | West Europe | ヨーロッパ展開時 |
| `sea` | Southeast Asia | アジア展開時 |
| `gbl` | Global（リージョン非依存） | Front Door, DNS Zone 等 |

---

## 4. リソース種別の略称

### 4.1 基盤リソース

| 略称 | リソース種別 | 最大文字数 | 使用可能文字 |
|------|-------------|-----------|-------------|
| `rg` | Resource Group | 90 | 英数字、ハイフン、アンダースコア、ピリオド |
| `mg` | Management Group | 90 | 英数字、ハイフン、アンダースコア、ピリオド |
| `sub` | Subscription | 64 | 英数字、ハイフン |

### 4.2 ネットワーク

| 略称 | リソース種別 | 最大文字数 | 使用可能文字 |
|------|-------------|-----------|-------------|
| `vnet` | Virtual Network | 64 | 英数字、ハイフン、アンダースコア、ピリオド |
| `snet` | Subnet | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `nsg` | Network Security Group | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `asg` | Application Security Group | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `rt` | Route Table | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `pip` | Public IP Address | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `lb` | Load Balancer | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `agw` | Application Gateway | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `fw` | Azure Firewall | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `vgw` | VPN Gateway | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `er` | ExpressRoute Circuit | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `bas` | Bastion Host | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `nic` | Network Interface | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `pe` | Private Endpoint | 64 | 英数字、ハイフン、アンダースコア、ピリオド |
| `pls` | Private Link Service | 80 | 英数字、ハイフン、アンダースコア、ピリオド |
| `dns` | Private DNS Zone | 63 | 英数字、ハイフン |
| `afd` | Front Door | 64 | 英数字、ハイフン |

### 4.3 コンピュート

| 略称 | リソース種別 | 最大文字数 | 使用可能文字 |
|------|-------------|-----------|-------------|
| `vm` | Virtual Machine | 15 (Windows), 64 (Linux) | 英数字、ハイフン |
| `vmss` | VM Scale Set | 64 | 英数字、ハイフン |
| `aks` | Azure Kubernetes Service | 63 | 英数字、ハイフン |
| `ca` | Container App | 32 | 小文字英数字、ハイフン |
| `cae` | Container App Environment | 60 | 英数字、ハイフン |
| `acr` | Container Registry | 50 | **英数字のみ**（ハイフン不可） |
| `aci` | Container Instance | 63 | 小文字英数字、ハイフン |
| `func` | Function App | 60 | 英数字、ハイフン |
| `app` | App Service | 60 | 英数字、ハイフン |
| `asp` | App Service Plan | 40 | 英数字、ハイフン |

### 4.4 データ

| 略称 | リソース種別 | 最大文字数 | 使用可能文字 |
|------|-------------|-----------|-------------|
| `sql` | Azure SQL Server | 63 | 小文字英数字、ハイフン |
| `sqldb` | SQL Database | 128 | 英数字、ハイフン、アンダースコア |
| `cosmos` | Cosmos DB Account | 44 | 小文字英数字、ハイフン |
| `redis` | Azure Cache for Redis | 63 | 英数字、ハイフン |
| `psql` | PostgreSQL Flexible Server | 63 | 小文字英数字、ハイフン |
| `mysql` | MySQL Flexible Server | 63 | 小文字英数字、ハイフン |
| `st` | Storage Account | 24 | **小文字英数字のみ** |
| `dls` | Data Lake Storage | 24 | **小文字英数字のみ** |

### 4.5 セキュリティ・監視

| 略称 | リソース種別 | 最大文字数 | 使用可能文字 |
|------|-------------|-----------|-------------|
| `kv` | Key Vault | 24 | 英数字、ハイフン |
| `id` | Managed Identity | 128 | 英数字、ハイフン、アンダースコア |
| `log` | Log Analytics Workspace | 63 | 英数字、ハイフン |
| `appi` | Application Insights | 255 | 英数字、ハイフン、アンダースコア、ピリオド |
| `ag` | Action Group | 12 (短縮名) | 英数字 |
| `alert` | Alert Rule | 260 | 英数字、ハイフン、アンダースコア |

---

## 5. 特殊な命名制約

### 5.1 グローバルに一意が必要なリソース

以下のリソースは Azure 全体で一意である必要がある。

| リソース | 対策 |
|----------|------|
| Storage Account | 組織コード + ランダムサフィックス: `sttfprodapp001` |
| Key Vault | 組織コード + 環境 + 用途: `kv-tf-prod-app-001` |
| Container Registry | 組織コード + 環境: `acrtfprod001` |
| App Service | 組織コード + 環境 + 用途: `tf-prod-jpe-app-api-001` |
| SQL Server | 組織コード + 環境: `tf-prod-jpe-sql-main-001` |

### 5.2 ハイフン不可のリソース

```hcl
# Storage Account: 小文字英数字のみ、3-24文字
# パターン: st<org><env><workload><instance>
locals {
  storage_account_name = "st${var.org}${var.environment}${var.workload}001"
}

# Container Registry: 英数字のみ、5-50文字
# パターン: acr<org><env><instance>
locals {
  acr_name = "acr${var.org}${var.environment}001"
}
```

### 5.3 VM のコンピュータ名制限

```hcl
# Windows VM: 最大15文字
# パターン: <env><role><instance>
locals {
  windows_computer_name = "${var.env_short}${var.role}${format("%03d", var.instance)}"
  # 例: "prodweb001" (10文字)
}

# Linux VM: 最大64文字
locals {
  linux_computer_name = "${var.org}-${var.environment}-${var.role}-${format("%03d", var.instance)}"
  # 例: "tf-prod-web-001"
}
```

---

## 6. Terraform での命名実装

### 6.1 命名モジュール

```hcl
# modules/naming/variables.tf
variable "org" {
  description = "組織コード"
  type        = string
  default     = "tf"
}

variable "environment" {
  description = "環境コード"
  type        = string

  validation {
    condition     = contains(["dev", "stg", "prod", "sandbox", "shared"], var.environment)
    error_message = "environment は dev, stg, prod, sandbox, shared のいずれかを指定してください。"
  }
}

variable "region" {
  description = "Azure リージョン"
  type        = string
  default     = "japaneast"
}

variable "workload" {
  description = "ワークロード名"
  type        = string
}

variable "instance" {
  description = "インスタンス番号"
  type        = string
  default     = "001"
}

# modules/naming/locals.tf
locals {
  region_codes = {
    japaneast      = "jpe"
    japanwest      = "jpw"
    eastus2        = "eus2"
    westeurope     = "weu"
    southeastasia  = "sea"
  }

  region_code = local.region_codes[var.region]
  prefix      = "${var.org}-${var.environment}-${local.region_code}"

  names = {
    resource_group         = "${local.prefix}-rg-${var.workload}-${var.instance}"
    virtual_network        = "${local.prefix}-vnet-${var.workload}-${var.instance}"
    subnet                 = "${local.prefix}-snet-${var.workload}"
    network_security_group = "${local.prefix}-nsg-${var.workload}-${var.instance}"
    key_vault              = "${local.prefix}-kv-${var.workload}-${var.instance}"
    app_service            = "${local.prefix}-app-${var.workload}-${var.instance}"
    function_app           = "${local.prefix}-func-${var.workload}-${var.instance}"
    container_app          = "${local.prefix}-ca-${var.workload}-${var.instance}"
    log_analytics          = "${local.prefix}-log-${var.workload}-${var.instance}"
    managed_identity       = "${local.prefix}-id-${var.workload}-${var.instance}"

    # ハイフン不可のリソース
    storage_account    = "st${var.org}${var.environment}${var.workload}${var.instance}"
    container_registry = "acr${var.org}${var.environment}${var.instance}"
  }
}

# modules/naming/outputs.tf
output "names" {
  description = "生成されたリソース名のマップ"
  value       = local.names
}

output "prefix" {
  description = "命名プレフィックス"
  value       = local.prefix
}
```

### 6.2 命名モジュールの使用例

```hcl
# environments/dev/main.tf
module "naming" {
  source = "../../modules/naming"

  org         = "tf"
  environment = "dev"
  region      = "japaneast"
  workload    = "app"
  instance    = "001"
}

resource "azurerm_resource_group" "main" {
  name     = module.naming.names.resource_group
  location = "japaneast"
  tags     = local.common_tags
}

resource "azurerm_key_vault" "main" {
  name                = module.naming.names.key_vault
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_name            = "standard"
  tenant_id           = data.azurerm_client_config.current.tenant_id
  tags                = local.common_tags
}
```

---

## 7. 命名のアンチパターン

```hcl
# ❌ BAD: 一貫性のない命名
resource "azurerm_resource_group" "rg" {
  name = "MyResourceGroup"           # PascalCase、略称なし、環境なし
}

resource "azurerm_virtual_network" "vnet" {
  name = "vnet1"                     # 情報量が少なすぎる
}

resource "azurerm_storage_account" "storage" {
  name = "my-storage-account"       # ハイフン使用不可
}

resource "azurerm_key_vault" "kv" {
  name = "keyvault"                  # 環境・組織の区別なし
}

# ✅ GOOD: 規約に準拠した命名
resource "azurerm_resource_group" "main" {
  name = "tf-dev-jpe-rg-app-001"
}

resource "azurerm_virtual_network" "hub" {
  name = "tf-dev-jpe-vnet-hub-001"
}

resource "azurerm_storage_account" "main" {
  name = "stsfdevapp001"
}

resource "azurerm_key_vault" "main" {
  name = "tf-dev-jpe-kv-app-001"
}
```

---

## 8. サブネット命名の追加ルール

特定用途のサブネットは Azure が名前を強制する場合がある。

| サブネット用途 | 必須名 | 備考 |
|---------------|--------|------|
| Azure Firewall | `AzureFirewallSubnet` | 名前変更不可 |
| Azure Firewall Management | `AzureFirewallManagementSubnet` | 名前変更不可 |
| VPN Gateway | `GatewaySubnet` | 名前変更不可 |
| Bastion | `AzureBastionSubnet` | 名前変更不可 |
| Route Server | `RouteServerSubnet` | 名前変更不可 |
| その他 | 命名規約に従う | `snet-app`, `snet-db` 等 |

---

## チェックリスト

### リソース作成時
- [ ] 命名パターン `<org>-<env>-<region>-<resource_type>-<workload>-<instance>` に従っているか
- [ ] リソース種別の略称が正しいか（上記表参照）
- [ ] 環境コードが正しいか（dev / stg / prod）
- [ ] リージョンコードが正しいか（jpe / jpw 等）
- [ ] 文字数制限を超えていないか
- [ ] 使用可能文字の制約を満たしているか（特に Storage Account, ACR）
- [ ] グローバル一意性が必要なリソースで一意になっているか

### 命名モジュール使用時
- [ ] 命名モジュールを使用してリソース名を生成しているか
- [ ] ハードコードされたリソース名がないか
- [ ] Azure 強制名のサブネット（GatewaySubnet 等）を正しく処理しているか

### レビュー時
- [ ] 同一環境内で命名パターンが一貫しているか
- [ ] 略称が組織内で統一されているか
- [ ] 新しいリソース種別の略称がドキュメントに追加されているか
