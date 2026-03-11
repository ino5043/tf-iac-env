# Web/API インフラ スキル

Web アプリケーションおよび API のデプロイ先インフラの選定と Terraform 実装を支援するスキル。
App Service、Container Apps、AKS の3つの選択肢について、判断基準と実装テンプレートを提供する。

---

## トリガー

以下のいずれかに該当する場合にこのスキルを使用する。

- Web アプリケーション / API のインフラ基盤を選定する
- App Service、Container Apps、AKS いずれかの Terraform テンプレートが必要
- CI/CD デプロイパイプラインを構成する
- Application Insights や Key Vault との統合パターンが必要

---

## デプロイ先 選定マトリクス

### 比較表

| 観点 | App Service | Container Apps | AKS |
|------|-------------|----------------|-----|
| 複雑性 | 低 | 中 | 高 |
| スケール | 垂直 + 水平（制限あり） | 水平（KEDA 連携） | 水平（無制限） |
| 月額コスト（目安） | 5,000〜30,000 円 | 3,000〜50,000 円 | 30,000〜200,000 円 |
| コンテナ対応 | 対応（オプション） | ネイティブ | ネイティブ |
| マイクロサービス数 | 1〜3 | 3〜20 | 10〜100+ |
| チーム Kubernetes 経験 | 不要 | 不要 | 必須 |
| カスタムネットワーク | 制限あり | 制限あり | フル制御 |
| GPU ワークロード | 非対応 | 非対応 | 対応 |
| ステートフル | 非推奨 | 非推奨 | 対応 |

### 選定フローチャート

```
開始
  │
  ├─ マイクロサービス数 > 10？
  │    YES → AKS
  │    NO ↓
  │
  ├─ コンテナが必要？
  │    NO → App Service
  │    YES ↓
  │
  ├─ Kubernetes の知識がある？
  │    YES かつ 高度なカスタマイズが必要 → AKS
  │    NO ↓
  │
  ├─ イベント駆動スケーリングが必要？
  │    YES → Container Apps
  │    NO ↓
  │
  └─ App Service (Container) または Container Apps
```

---

## App Service テンプレート

### Terraform 実装

```hcl
# App Service Plan
resource "azurerm_service_plan" "main" {
  name                = "plan-${local.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  os_type             = "Linux"
  sku_name            = var.environment == "prod" ? "P1v3" : "B1"
  tags                = local.common_tags
}

# App Service
resource "azurerm_linux_web_app" "main" {
  name                = "app-${local.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  service_plan_id     = azurerm_service_plan.main.id
  tags                = local.common_tags

  https_only = true

  site_config {
    always_on           = var.environment == "prod" ? true : false
    minimum_tls_version = "1.2"
    ftps_state          = "Disabled"
    http2_enabled       = true

    application_stack {
      node_version = "20-lts"
    }

    ip_restriction_default_action = "Deny"

    ip_restriction {
      name       = "AllowFrontDoor"
      action     = "Allow"
      service_tag = "AzureFrontDoor.Backend"
      priority   = 100
    }
  }

  app_settings = {
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.main.connection_string
    "WEBSITE_RUN_FROM_PACKAGE"              = "1"
  }

  identity {
    type = "SystemAssigned"
  }

  sticky_settings {
    app_setting_names = [
      "APPLICATIONINSIGHTS_CONNECTION_STRING",
    ]
  }
}

# Staging Slot（本番環境のみ）
resource "azurerm_linux_web_app_slot" "staging" {
  count          = var.environment == "prod" ? 1 : 0
  name           = "staging"
  app_service_id = azurerm_linux_web_app.main.id

  site_config {
    always_on           = true
    minimum_tls_version = "1.2"
    ftps_state          = "Disabled"

    application_stack {
      node_version = "20-lts"
    }
  }

  app_settings = {
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.main.connection_string
    "WEBSITE_RUN_FROM_PACKAGE"              = "1"
  }

  identity {
    type = "SystemAssigned"
  }
}

# Custom Domain + Managed Certificate
resource "azurerm_app_service_custom_hostname_binding" "main" {
  count               = var.custom_domain != "" ? 1 : 0
  hostname            = var.custom_domain
  app_service_name    = azurerm_linux_web_app.main.name
  resource_group_name = var.resource_group_name
}

resource "azurerm_app_service_managed_certificate" "main" {
  count                      = var.custom_domain != "" ? 1 : 0
  custom_hostname_binding_id = azurerm_app_service_custom_hostname_binding.main[0].id
}
```

---

## Container Apps テンプレート

### Terraform 実装

```hcl
# Container Apps Environment
resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${local.name_prefix}"
  location                   = var.location
  resource_group_name        = var.resource_group_name
  log_analytics_workspace_id = var.log_analytics_workspace_id
  tags                       = local.common_tags

  infrastructure_subnet_id = var.subnet_id # VNet 統合

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
    minimum_count         = 0
    maximum_count         = 0
  }
}

# Container App
resource "azurerm_container_app" "api" {
  name                         = "ca-api-${local.name_prefix}"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Multiple"
  tags                         = local.common_tags

  template {
    min_replicas = var.environment == "prod" ? 2 : 0
    max_replicas = var.environment == "prod" ? 10 : 3

    container {
      name   = "api"
      image  = "${var.acr_login_server}/${var.image_name}:${var.image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name        = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        secret_name = "appinsights-connection-string"
      }

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }

      liveness_probe {
        path             = "/health/live"
        port             = 8080
        transport        = "HTTP"
        initial_delay    = 10
        interval_seconds = 30
      }

      readiness_probe {
        path             = "/health/ready"
        port             = 8080
        transport        = "HTTP"
        interval_seconds = 10
      }
    }

    # KEDA スケーリングルール
    custom_scale_rule {
      name             = "http-scaling"
      custom_rule_type = "http"
      metadata = {
        concurrentRequests = "50"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "http"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  secret {
    name  = "appinsights-connection-string"
    value = var.appinsights_connection_string
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = var.database_url_secret_id
    identity            = "system"
  }

  identity {
    type = "SystemAssigned"
  }

  registry {
    server   = var.acr_login_server
    identity = "system"
  }
}
```

---

## AKS テンプレート

### Terraform 実装

```hcl
# AKS Cluster
resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-${local.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  dns_prefix          = "aks-${local.name_prefix}"
  kubernetes_version  = var.kubernetes_version
  tags                = local.common_tags

  default_node_pool {
    name                = "system"
    node_count          = var.environment == "prod" ? 3 : 1
    vm_size             = var.environment == "prod" ? "Standard_D4s_v5" : "Standard_B2s"
    os_disk_size_gb     = 128
    os_disk_type        = "Managed"
    vnet_subnet_id      = var.system_subnet_id
    max_pods            = 30
    enable_auto_scaling = var.environment == "prod"
    min_count           = var.environment == "prod" ? 3 : null
    max_count           = var.environment == "prod" ? 5 : null

    upgrade_settings {
      max_surge = "33%"
    }
  }

  identity {
    type = "SystemAssigned"
  }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled     = true
    admin_group_object_ids = [var.aks_admin_group_id]
  }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "calico"
    load_balancer_sku = "standard"
    service_cidr      = "172.16.0.0/16"
    dns_service_ip    = "172.16.0.10"
  }

  oms_agent {
    log_analytics_workspace_id = var.log_analytics_workspace_id
  }

  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "5m"
  }

  maintenance_window {
    allowed {
      day   = "Sunday"
      hours = [0, 1, 2, 3, 4]
    }
  }
}

# User Node Pool（ワークロード用）
resource "azurerm_kubernetes_cluster_node_pool" "user" {
  name                  = "user"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = var.environment == "prod" ? "Standard_D4s_v5" : "Standard_B2s"
  node_count            = var.environment == "prod" ? 2 : 1
  vnet_subnet_id        = var.user_subnet_id
  max_pods              = 30
  enable_auto_scaling   = var.environment == "prod"
  min_count             = var.environment == "prod" ? 2 : null
  max_count             = var.environment == "prod" ? 20 : null
  tags                  = local.common_tags

  node_taints = []
  node_labels = {
    "workload-type" = "user"
  }
}
```

---

## 共通パターン

### Application Insights 統合

```hcl
resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = var.log_analytics_workspace_id
  application_type    = "web"
  tags                = local.common_tags
}
```

### Key Vault 参照（Managed Identity）

```hcl
resource "azurerm_key_vault_access_policy" "app" {
  key_vault_id = var.key_vault_id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_linux_web_app.main.identity[0].principal_id

  secret_permissions = ["Get", "List"]
}
```

### CI/CD デプロイパターン

| 方式 | App Service | Container Apps | AKS |
|------|-------------|----------------|-----|
| 推奨 | Slot Swap | Revision ベース | Helm + ArgoCD |
| Blue/Green | Staging Slot → Swap | Traffic Weight 切り替え | Namespace 分離 |
| カナリア | Traffic Routing | Traffic Weight 段階 | Istio / Linkerd |
| ロールバック | 前 Slot に Swap | 前 Revision に切り替え | `helm rollback` |

---

## チェックリスト

- [ ] 選定マトリクスに基づいてデプロイ先を選定したか
- [ ] Managed Identity を使用しシークレットの直接埋め込みを避けたか
- [ ] Application Insights を統合したか
- [ ] ヘルスチェック（Liveness/Readiness）を設定したか
- [ ] TLS 1.2 以上を強制したか
- [ ] 本番環境で高可用性構成（最小 2 インスタンス）にしたか
- [ ] デプロイスロット / Revision でゼロダウンタイムデプロイを構成したか
- [ ] ネットワーク制限（VNet 統合、IP 制限）を設定したか
