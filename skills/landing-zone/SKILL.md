# Landing Zone スキル

Azure Landing Zone の設計・構築ガイド。Management Group 階層、Hub-Spoke ネットワーク、
ポリシー、共有サービスを含む企業基盤の Terraform 実装を支援する。

---

## トリガー

以下のいずれかに該当する場合にこのスキルを使用する。

- Azure テナントの基盤設計を行う
- Management Group 階層を構築する
- Hub-Spoke ネットワークを設計する
- Azure Policy を体系的に適用する

---

## Landing Zone アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Tenant Root Group                            │
├──────────────────────────┬───────────────────────────────────────────┤
│       Platform           │              Workloads                   │
├────────┬────────┬────────┼─────────────────┬────────────┬───────────┤
│Identity│Mgmt    │Conn    │   Production    │    Dev     │  Sandbox  │
│        │        │ectivity│                 │            │           │
│Entra ID│Log     │Hub VNet│ Spoke VNet 1    │ Spoke VNet │ 自由検証  │
│PIM     │Monitor │FW/NVA  │ Spoke VNet 2    │ 2          │ Policy    │
│CA      │Sentinel│VPN/ER  │                 │            │ 最小限   │
└────────┴────────┴────────┴─────────────────┴────────────┴───────────┘
```

---

## Management Group 階層

### 設計方針

| レベル | Management Group | 目的 |
|--------|-----------------|------|
| L0 | Tenant Root Group | テナント最上位（既定） |
| L1 | Organization | 組織全体のガバナンス |
| L2 | Platform | プラットフォームサービス |
| L2 | Workloads | ワークロード環境 |
| L2 | Sandbox | 検証・実験環境 |
| L3 | Identity | Entra ID、認証基盤 |
| L3 | Management | 監視、ログ、自動化 |
| L3 | Connectivity | ネットワーク接続基盤 |
| L3 | Production | 本番ワークロード |
| L3 | Development | 開発・テスト環境 |

### Terraform 実装

```hcl
# Management Group 階層
resource "azurerm_management_group" "organization" {
  display_name = "Organization"
}

resource "azurerm_management_group" "platform" {
  display_name               = "Platform"
  parent_management_group_id = azurerm_management_group.organization.id
}

resource "azurerm_management_group" "workloads" {
  display_name               = "Workloads"
  parent_management_group_id = azurerm_management_group.organization.id
}

resource "azurerm_management_group" "sandbox" {
  display_name               = "Sandbox"
  parent_management_group_id = azurerm_management_group.organization.id
}

# Platform 配下
resource "azurerm_management_group" "identity" {
  display_name               = "Identity"
  parent_management_group_id = azurerm_management_group.platform.id
}

resource "azurerm_management_group" "management" {
  display_name               = "Management"
  parent_management_group_id = azurerm_management_group.platform.id
}

resource "azurerm_management_group" "connectivity" {
  display_name               = "Connectivity"
  parent_management_group_id = azurerm_management_group.platform.id
}

# Workloads 配下
resource "azurerm_management_group" "production" {
  display_name               = "Production"
  parent_management_group_id = azurerm_management_group.workloads.id
}

resource "azurerm_management_group" "development" {
  display_name               = "Development"
  parent_management_group_id = azurerm_management_group.workloads.id
}
```

---

## Hub-Spoke ネットワーク トポロジー

### ネットワーク設計

```
                    ┌─────────────────────────────┐
                    │        Hub VNet              │
                    │      10.0.0.0/16             │
                    ├──────────┬──────────┬────────┤
                    │AzFW Snet │GW Snet   │Bastion │
                    │10.0.1/24 │10.0.2/24 │10.0.3/24│
                    └────┬─────┴─────┬────┴────────┘
                         │           │
              Peering    │           │    Peering
         ┌───────────────┘           └───────────────┐
         ▼                                           ▼
┌────────────────────┐                  ┌────────────────────┐
│   Spoke VNet 1     │                  │   Spoke VNet 2     │
│   10.1.0.0/16      │                  │   10.2.0.0/16      │
│  (Production)      │                  │  (Development)     │
├──────────┬─────────┤                  ├──────────┬─────────┤
│App Snet  │DB Snet  │                  │App Snet  │DB Snet  │
│10.1.1/24 │10.1.2/24│                  │10.2.1/24 │10.2.2/24│
└──────────┴─────────┘                  └──────────┴─────────┘
```

### IP アドレス設計

| VNet | CIDR | 用途 |
|------|------|------|
| Hub | 10.0.0.0/16 | 共有サービス、ファイアウォール、ゲートウェイ |
| Spoke-Prod | 10.1.0.0/16 | 本番ワークロード |
| Spoke-Dev | 10.2.0.0/16 | 開発・テスト |
| Spoke-Staging | 10.3.0.0/16 | ステージング |

### Hub VNet Terraform

```hcl
resource "azurerm_resource_group" "connectivity" {
  name     = "rg-connectivity-${var.environment}"
  location = var.location
  tags     = local.common_tags
}

resource "azurerm_virtual_network" "hub" {
  name                = "vnet-hub-${var.location}"
  location            = azurerm_resource_group.connectivity.location
  resource_group_name = azurerm_resource_group.connectivity.name
  address_space       = ["10.0.0.0/16"]
  tags                = local.common_tags
}

resource "azurerm_subnet" "firewall" {
  name                 = "AzureFirewallSubnet" # 名前は固定
  resource_group_name  = azurerm_resource_group.connectivity.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "gateway" {
  name                 = "GatewaySubnet" # 名前は固定
  resource_group_name  = azurerm_resource_group.connectivity.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.2.0/24"]
}

resource "azurerm_subnet" "bastion" {
  name                 = "AzureBastionSubnet" # 名前は固定
  resource_group_name  = azurerm_resource_group.connectivity.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.0.3.0/24"]
}
```

### VNet Peering

```hcl
resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  for_each = var.spoke_vnets

  name                         = "peer-hub-to-${each.key}"
  resource_group_name          = azurerm_resource_group.connectivity.name
  virtual_network_name         = azurerm_virtual_network.hub.name
  remote_virtual_network_id    = each.value.id
  allow_forwarded_traffic      = true
  allow_gateway_transit        = true
  allow_virtual_network_access = true
}

resource "azurerm_virtual_network_peering" "spoke_to_hub" {
  for_each = var.spoke_vnets

  name                         = "peer-${each.key}-to-hub"
  resource_group_name          = each.value.resource_group_name
  virtual_network_name         = each.value.name
  remote_virtual_network_id    = azurerm_virtual_network.hub.id
  allow_forwarded_traffic      = true
  use_remote_gateways          = true
  allow_virtual_network_access = true
}
```

---

## Policy 適用

### Organization レベル（全体共通）

| ポリシー | 効果 | 目的 |
|---------|------|------|
| Allowed Locations | Deny | Japan East / Japan West のみ許可 |
| Require Tag | Deny | Environment タグ必須 |
| Audit Diagnostic Settings | Audit | 診断設定の監査 |
| Deny Public IP | Deny | パブリック IP の作成を禁止 |

### Terraform 実装

```hcl
resource "azurerm_management_group_policy_assignment" "allowed_locations" {
  name                 = "allowed-locations"
  management_group_id  = azurerm_management_group.organization.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c"

  parameters = jsonencode({
    listOfAllowedLocations = {
      value = ["japaneast", "japanwest"]
    }
  })
}

resource "azurerm_management_group_policy_assignment" "require_tag" {
  name                 = "require-env-tag"
  management_group_id  = azurerm_management_group.organization.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/871b6d14-10aa-478d-b590-94f262ecfa99"

  parameters = jsonencode({
    tagName = { value = "Environment" }
  })
}
```

---

## 共有サービス

### 一覧

| サービス | 配置先 | 用途 |
|---------|--------|------|
| Log Analytics Workspace | Management サブスクリプション | 集中ログ収集 |
| Key Vault | Platform | 共有シークレット管理 |
| Container Registry | Platform | 共有コンテナイメージ |
| Azure Bastion | Hub VNet | セキュアなリモートアクセス |
| Azure Firewall | Hub VNet | 送信トラフィック制御 |

### 集中ログ基盤

```hcl
resource "azurerm_log_analytics_workspace" "central" {
  name                = "log-central-${var.environment}"
  location            = var.location
  resource_group_name = azurerm_resource_group.management.name
  sku                 = "PerGB2018"
  retention_in_days   = 90
  tags                = local.common_tags
}

resource "azurerm_log_analytics_solution" "security" {
  solution_name         = "Security"
  location              = var.location
  resource_group_name   = azurerm_resource_group.management.name
  workspace_resource_id = azurerm_log_analytics_workspace.central.id
  workspace_name        = azurerm_log_analytics_workspace.central.name

  plan {
    publisher = "Microsoft"
    product   = "OMSGallery/Security"
  }
}
```

---

## モジュール構成

Landing Zone 全体を以下のモジュールに分割する。

```
modules/
├── management-groups/     # Management Group 階層
├── hub-networking/        # Hub VNet、Firewall、Bastion、Gateway
├── spoke-networking/      # Spoke VNet、Peering、NSG
├── policy-assignments/    # Azure Policy の適用
├── log-analytics/         # 集中ログ基盤
├── shared-services/       # Key Vault、ACR 等
└── rbac/                  # ロール割り当て
```

---

## チェックリスト

- [ ] Management Group 階層が組織構造に合致しているか
- [ ] Hub-Spoke の IP アドレス空間が重複していないか
- [ ] VNet Peering が双方向で設定されているか
- [ ] Azure Policy が適切な Management Group レベルで適用されているか
- [ ] 集中ログ基盤にすべてのサブスクリプションが接続されているか
- [ ] Bastion が Hub VNet に配置されているか
- [ ] 緊急アクセスアカウント（Break-Glass）が設定されているか
- [ ] 各サブスクリプションに RBAC が設定されているか
