# ネットワークセキュリティ規約

Azure ネットワーク設計とセキュリティの必須ルール。VNet 設計、NSG、Private Endpoint、WAF に適用する。

---

## 1. VNet 設計

### 1.1 Hub-Spoke トポロジ

```
                    ┌────────────────────┐
                    │     Internet       │
                    └────────┬───────────┘
                             │
                    ┌────────▼───────────┐
                    │     Hub VNet       │
                    │  10.0.0.0/16       │
                    │                    │
                    │  ┌──────────────┐  │
                    │  │ Azure FW     │  │
                    │  │ 10.0.1.0/26  │  │
                    │  └──────────────┘  │
                    │  ┌──────────────┐  │
                    │  │ VPN Gateway  │  │
                    │  │ 10.0.2.0/27  │  │
                    │  └──────────────┘  │
                    │  ┌──────────────┐  │
                    │  │ Bastion      │  │
                    │  │ 10.0.3.0/26  │  │
                    │  └──────────────┘  │
                    └──┬────────────┬────┘
                       │ Peering    │ Peering
            ┌──────────▼──┐    ┌───▼───────────┐
            │ Spoke VNet  │    │ Spoke VNet    │
            │ (Dev)       │    │ (Prod)        │
            │ 10.1.0.0/16 │    │ 10.2.0.0/16  │
            │             │    │               │
            │ ┌─────────┐ │    │ ┌───────────┐ │
            │ │App      │ │    │ │App        │ │
            │ │10.1.1/24│ │    │ │10.2.1/24  │ │
            │ └─────────┘ │    │ └───────────┘ │
            │ ┌─────────┐ │    │ ┌───────────┐ │
            │ │DB       │ │    │ │DB         │ │
            │ │10.1.2/24│ │    │ │10.2.2/24  │ │
            │ └─────────┘ │    │ └───────────┘ │
            │ ┌─────────┐ │    │ ┌───────────┐ │
            │ │PE       │ │    │ │PE         │ │
            │ │10.1.3/24│ │    │ │10.2.3/24  │ │
            │ └─────────┘ │    │ └───────────┘ │
            └─────────────┘    └───────────────┘
```

### 1.2 アドレス空間設計

| VNet | CIDR | 用途 |
|------|------|------|
| Hub | `10.0.0.0/16` | 共通基盤（FW, GW, Bastion） |
| Spoke Dev | `10.1.0.0/16` | 開発環境 |
| Spoke Stg | `10.2.0.0/16` | ステージング環境 |
| Spoke Prod | `10.3.0.0/16` | 本番環境 |
| オンプレミス | `172.16.0.0/12` | VPN/ExpressRoute 接続先 |

**原則**:
- アドレス空間の重複を絶対に避ける
- 将来の拡張を見据えて十分な空間を確保する（`/16` 推奨）
- サブネットは最小 `/27`（32 IP、Azure 予約 5 IP を考慮）

### 1.3 サブネット設計

| サブネット | CIDR サイズ | 用途 | 備考 |
|-----------|-----------|------|------|
| `AzureFirewallSubnet` | `/26` | Azure Firewall | 最小 `/26` 必須 |
| `GatewaySubnet` | `/27` | VPN/ER Gateway | 最小 `/27` 推奨 |
| `AzureBastionSubnet` | `/26` | Bastion | 最小 `/26` 必須 |
| `snet-app` | `/24` | アプリケーション | 251 ホスト |
| `snet-db` | `/24` | データベース | 251 ホスト |
| `snet-pe` | `/24` | Private Endpoint | 251 ホスト |
| `snet-aks` | `/21` | AKS ノードプール | 2043 ホスト |
| `snet-agw` | `/24` | Application Gateway | 251 ホスト |

### 1.4 Terraform 実装

```hcl
# modules/networking/main.tf
resource "azurerm_virtual_network" "this" {
  name                = var.vnet_name
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = var.address_space
  tags                = var.tags
}

resource "azurerm_subnet" "this" {
  for_each = var.subnets

  name                                          = each.key
  resource_group_name                           = azurerm_virtual_network.this.resource_group_name
  virtual_network_name                          = azurerm_virtual_network.this.name
  address_prefixes                              = each.value.address_prefixes
  private_endpoint_network_policies             = each.value.private_endpoint_network_policies
  private_link_service_network_policies_enabled = each.value.private_link_service_network_policies_enabled

  dynamic "delegation" {
    for_each = each.value.delegation != null ? [each.value.delegation] : []
    content {
      name = delegation.value.name
      service_delegation {
        name    = delegation.value.service_delegation_name
        actions = delegation.value.actions
      }
    }
  }
}

# VNet Peering (Hub to Spoke)
resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  name                         = "peer-hub-to-${var.spoke_name}"
  resource_group_name          = var.hub_resource_group_name
  virtual_network_name         = var.hub_vnet_name
  remote_virtual_network_id    = azurerm_virtual_network.this.id
  allow_forwarded_traffic      = true
  allow_gateway_transit        = true
  allow_virtual_network_access = true
}

resource "azurerm_virtual_network_peering" "spoke_to_hub" {
  name                         = "peer-${var.spoke_name}-to-hub"
  resource_group_name          = azurerm_virtual_network.this.resource_group_name
  virtual_network_name         = azurerm_virtual_network.this.name
  remote_virtual_network_id    = var.hub_vnet_id
  allow_forwarded_traffic      = true
  use_remote_gateways          = true
  allow_virtual_network_access = true
}
```

---

## 2. NSG（ネットワークセキュリティグループ）

### 2.1 基本原則

- **Deny-by-Default**: 明示的に許可しないトラフィックはすべて拒否
- **Least Privilege**: 必要最小限のポート・プロトコル・送信元のみ許可
- **Service Tag の活用**: IP アドレスの直接指定を避ける

### 2.2 標準 NSG ルール構成

```hcl
# アプリケーションサブネット用 NSG
resource "azurerm_network_security_group" "app" {
  name                = "${var.name_prefix}-nsg-app-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

# ✅ GOOD: Service Tag を使用した明確なルール
resource "azurerm_network_security_rule" "allow_https_from_agw" {
  name                        = "AllowHTTPSFromAGW"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = "10.0.4.0/24"  # AGW サブネット
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.app.name
}

resource "azurerm_network_security_rule" "allow_health_probe" {
  name                        = "AllowAzureLoadBalancerHealthProbe"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "AzureLoadBalancer"
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.app.name
}

# 明示的な Deny All（ログ記録用）
resource "azurerm_network_security_rule" "deny_all_inbound" {
  name                        = "DenyAllInbound"
  priority                    = 4096
  direction                   = "Inbound"
  access                      = "Deny"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "*"
  destination_address_prefix  = "*"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.app.name
}
```

### 2.3 NSG ルールの優先度割り当て

| 優先度範囲 | 用途 |
|-----------|------|
| 100-199 | アプリケーション固有の許可ルール |
| 200-299 | 管理アクセス（Bastion, JumpBox） |
| 300-399 | Azure サービス連携 |
| 400-499 | モニタリング・診断 |
| 4096 | 明示的 Deny All（ログ記録用） |

### 2.4 Service Tag 一覧（頻出）

| Service Tag | 説明 |
|-------------|------|
| `Internet` | インターネット全体 |
| `VirtualNetwork` | VNet 内 + Peering 先 |
| `AzureLoadBalancer` | Azure Load Balancer ヘルスプローブ |
| `AzureCloud` | Azure データセンター全体 |
| `AzureCloud.JapanEast` | 東日本リージョンの Azure IP |
| `Storage.JapanEast` | 東日本の Azure Storage |
| `Sql.JapanEast` | 東日本の Azure SQL |
| `AzureKeyVault` | Key Vault サービス |
| `AzureMonitor` | Azure Monitor サービス |
| `AzureActiveDirectory` | Entra ID サービス |

### 2.5 NSG のアンチパターン

```hcl
# ❌ BAD: すべてのポートを開放
resource "azurerm_network_security_rule" "bad_allow_all" {
  name                        = "AllowAll"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "*"
  source_port_range           = "*"
  destination_port_range      = "*"
  source_address_prefix       = "*"        # 全世界から許可
  destination_address_prefix  = "*"
  # ...
}

# ❌ BAD: RDP/SSH をインターネットに公開
resource "azurerm_network_security_rule" "bad_rdp" {
  name                        = "AllowRDP"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "3389"
  source_address_prefix       = "Internet"  # 危険
  destination_address_prefix  = "*"
  # ...
}

# ✅ GOOD: Bastion 経由でのみ管理アクセスを許可
resource "azurerm_network_security_rule" "allow_bastion" {
  name                        = "AllowBastionSSH"
  priority                    = 200
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefix       = "10.0.3.0/26"  # Bastion サブネットのみ
  destination_address_prefix  = "*"
  # ...
}
```

---

## 3. Private Endpoint

### 3.1 必須ポリシー

以下の PaaS サービスには **必ず** Private Endpoint を構成する。パブリックアクセスを無効化する。

| サービス | Private Link Sub-Resource | Private DNS Zone |
|----------|--------------------------|-----------------|
| Azure SQL | `sqlServer` | `privatelink.database.windows.net` |
| Azure Storage (Blob) | `blob` | `privatelink.blob.core.windows.net` |
| Azure Storage (Table) | `table` | `privatelink.table.core.windows.net` |
| Azure Storage (Queue) | `queue` | `privatelink.queue.core.windows.net` |
| Azure Storage (File) | `file` | `privatelink.file.core.windows.net` |
| Key Vault | `vault` | `privatelink.vaultcore.azure.net` |
| Cosmos DB | `Sql` | `privatelink.documents.azure.com` |
| Container Registry | `registry` | `privatelink.azurecr.io` |
| PostgreSQL Flexible | `postgresqlServer` | `privatelink.postgres.database.azure.com` |
| Redis Cache | `redisCache` | `privatelink.redis.cache.windows.net` |

### 3.2 Terraform 実装

```hcl
# Private Endpoint + Private DNS Zone 統合
resource "azurerm_private_endpoint" "sql" {
  name                = "${var.name_prefix}-pe-sql-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "psc-sql"
    is_manual_connection           = false
    private_connection_resource_id = azurerm_mssql_server.this.id
    subresource_names              = ["sqlServer"]
  }

  private_dns_zone_group {
    name                 = "dns-zone-group"
    private_dns_zone_ids = [var.sql_private_dns_zone_id]
  }
}

# Private DNS Zone（Hub VNet に集中管理）
resource "azurerm_private_dns_zone" "sql" {
  name                = "privatelink.database.windows.net"
  resource_group_name = var.hub_resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "sql_hub" {
  name                  = "link-hub"
  resource_group_name   = var.hub_resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.sql.name
  virtual_network_id    = var.hub_vnet_id
  registration_enabled  = false
}

resource "azurerm_private_dns_zone_virtual_network_link" "sql_spoke" {
  for_each = var.spoke_vnet_ids

  name                  = "link-${each.key}"
  resource_group_name   = var.hub_resource_group_name
  private_dns_zone_name = azurerm_private_dns_zone.sql.name
  virtual_network_id    = each.value
  registration_enabled  = false
}

# パブリックアクセスの無効化
resource "azurerm_mssql_server" "this" {
  name                          = var.sql_server_name
  resource_group_name           = var.resource_group_name
  location                      = var.location
  version                       = "12.0"
  administrator_login           = var.admin_login
  administrator_login_password  = var.admin_password
  public_network_access_enabled = false  # パブリックアクセス無効化

  azuread_administrator {
    login_username = var.aad_admin_login
    object_id      = var.aad_admin_object_id
  }

  tags = var.tags
}
```

---

## 4. WAF（Web Application Firewall）

### 4.1 WAF 配置の選択基準

| 要件 | 推奨サービス | 理由 |
|------|-------------|------|
| グローバル分散 + SSL オフロード | **Front Door + WAF** | CDN 統合、DDoS 保護 |
| リージョン内 L7 LB | **Application Gateway + WAF v2** | VNet 統合、Private Link 対応 |
| API 保護 | **API Management + WAF** | レート制限、認証統合 |

### 4.2 WAF ポリシー設定

```hcl
resource "azurerm_web_application_firewall_policy" "this" {
  name                = "${var.name_prefix}-waf-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags

  policy_settings {
    enabled                     = true
    mode                        = var.environment == "prod" ? "Prevention" : "Detection"
    request_body_check          = true
    max_request_body_size_in_kb = 128
    file_upload_limit_in_mb     = 100
  }

  # OWASP 3.2 ルールセット
  managed_rules {
    managed_rule_set {
      type    = "OWASP"
      version = "3.2"

      # 誤検知が多いルールのみ除外（要根拠の記録）
      rule_group_override {
        rule_group_name = "REQUEST-942-APPLICATION-ATTACK-SQLI"
        rule {
          id      = "942130"
          enabled = false
          action  = "Log"
        }
      }
    }

    # Bot 保護
    managed_rule_set {
      type    = "Microsoft_BotManagerRuleSet"
      version = "1.0"
    }
  }

  # カスタムルール: レート制限
  custom_rules {
    name      = "RateLimitRule"
    priority  = 1
    rule_type = "RateLimitRule"
    action    = "Block"

    rate_limit_duration_in_minutes = 1
    rate_limit_threshold           = 100

    match_conditions {
      match_variables {
        variable_name = "RemoteAddr"
      }
      operator           = "IPMatch"
      negation_condition = true
      match_values       = var.allowed_ip_ranges
    }
  }

  # カスタムルール: Geo ブロック
  custom_rules {
    name      = "GeoBlock"
    priority  = 2
    rule_type = "MatchRule"
    action    = "Block"

    match_conditions {
      match_variables {
        variable_name = "RemoteAddr"
      }
      operator           = "GeoMatch"
      negation_condition = true
      match_values       = ["JP", "US"]  # 日本と米国以外をブロック
    }
  }
}
```

---

## 5. DDoS Protection

### 5.1 プランの選択

| プラン | コスト | 機能 | 推奨ケース |
|--------|------|------|-----------|
| DDoS Infrastructure Protection | 無料 | L3/L4 基本保護 | 小規模環境、コスト重視 |
| DDoS Network Protection | ~$2,944/月 | L3/L4 高度保護、メトリクス、SLA | 本番環境、規制要件あり |

### 5.2 DDoS Protection の適用

```hcl
# DDoS Protection Plan（組織で 1 つ）
resource "azurerm_network_ddos_protection_plan" "this" {
  count = var.enable_ddos_protection ? 1 : 0

  name                = "${var.name_prefix}-ddos-001"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

# VNet に DDoS Protection を関連付け
resource "azurerm_virtual_network" "hub" {
  name                = var.hub_vnet_name
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = var.hub_address_space

  dynamic "ddos_protection_plan" {
    for_each = var.enable_ddos_protection ? [1] : []
    content {
      id     = azurerm_network_ddos_protection_plan.this[0].id
      enable = true
    }
  }

  tags = var.tags
}
```

---

## 6. NSG フローログと監視

### 6.1 NSG フローログの有効化

```hcl
resource "azurerm_network_watcher_flow_log" "app" {
  network_watcher_name = var.network_watcher_name
  resource_group_name  = var.network_watcher_resource_group_name
  name                 = "fl-${azurerm_network_security_group.app.name}"

  network_security_group_id = azurerm_network_security_group.app.id
  storage_account_id        = var.flow_log_storage_account_id
  enabled                   = true
  version                   = 2

  retention_policy {
    enabled = true
    days    = 90
  }

  traffic_analytics {
    enabled               = true
    workspace_id          = var.log_analytics_workspace_id
    workspace_region      = var.location
    workspace_resource_id = var.log_analytics_workspace_resource_id
    interval_in_minutes   = 10
  }

  tags = var.tags
}
```

---

## 7. ネットワークフロー設計パターン

### 7.1 インバウンドトラフィック

```
Internet
    │
    ▼
Front Door / Application Gateway (WAF)
    │
    ▼
NSG (snet-agw) ──→ 許可: Front Door Service Tag
    │
    ▼
Application Gateway / Load Balancer
    │
    ▼
NSG (snet-app) ──→ 許可: AGW サブネットのみ
    │
    ▼
App Service / Container App / VM
    │
    ▼
Private Endpoint (snet-pe)
    │
    ▼
Azure SQL / Storage / Key Vault
```

### 7.2 管理アクセス

```
管理者 PC
    │
    ▼
Azure Bastion (snet-bastion)
    │ SSH/RDP over TLS
    ▼
NSG (snet-app/snet-db) ──→ 許可: Bastion サブネットのみ
    │
    ▼
管理対象 VM
```

---

## チェックリスト

### VNet 設計時
- [ ] Hub-Spoke トポロジを採用しているか
- [ ] アドレス空間に重複がないか
- [ ] サブネットのサイズが用途に対して適切か（Azure 予約 5 IP を考慮）
- [ ] VNet Peering が双方向で設定されているか
- [ ] Gateway Transit / Remote Gateway が正しく設定されているか

### NSG 設定時
- [ ] Deny-by-Default 原則に従っているか
- [ ] RDP (3389) / SSH (22) がインターネットに公開されていないか
- [ ] Service Tag を使用しているか（IP ハードコードを避ける）
- [ ] ルールの優先度が規約に従っているか
- [ ] NSG フローログが有効化されているか

### Private Endpoint 設定時
- [ ] 対象 PaaS サービスに Private Endpoint を構成したか
- [ ] パブリックアクセスを無効化したか
- [ ] Private DNS Zone を Hub VNet にリンクしているか
- [ ] Spoke VNet にも DNS Zone をリンクしているか

### WAF 設定時
- [ ] 本番環境では Prevention モードになっているか
- [ ] OWASP ルールセットを有効化しているか
- [ ] ルール除外には根拠を記録しているか
- [ ] レート制限を設定しているか
- [ ] Geo ブロックを検討したか
