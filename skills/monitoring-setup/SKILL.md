# Monitoring Setup スキル

Azure Monitor の包括的なセットアップガイド。Log Analytics、Diagnostic Settings、
アラートルール、Action Group、Application Insights、ダッシュボードの Terraform 実装を提供する。

---

## トリガー

以下のいずれかに該当する場合にこのスキルを使用する。

- Azure Monitor の基盤を構築する
- リソースの診断設定を有効化する
- アラートルールを設計・実装する
- 運用ダッシュボードを作成する
- Application Insights でアプリケーション監視を設定する

---

## 監視アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────┐
│                     Azure Resources                      │
│  App Service │ Container Apps │ SQL DB │ Key Vault │ ... │
└──────┬───────┴───────┬────────┴───┬────┴─────┬─────┘
       │               │            │          │
       ▼               ▼            ▼          ▼
┌──────────────────────────────────────────────────────────┐
│                  Diagnostic Settings                     │
│            (ログ + メトリクス → 送信先指定)               │
└──────────────────────┬───────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│Log Analytics │ │ Storage  │ │ Event Hub    │
│  Workspace   │ │ Account  │ │ (SIEM 連携)  │
└──────┬───────┘ └──────────┘ └──────────────┘
       │
       ├─────────────────────┐
       ▼                     ▼
┌──────────────┐    ┌──────────────────┐
│ Alert Rules  │    │    Workbooks     │
│  ・Metric    │    │   ・ダッシュボード │
│  ・Log       │    │   ・レポート      │
│  ・Activity  │    │                  │
└──────┬───────┘    └──────────────────┘
       │
       ▼
┌──────────────┐
│ Action Group │
│  ・Email     │
│  ・SMS       │
│  ・Webhook   │
│  ・Function  │
│  ・Logic App │
└──────────────┘
```

---

## Log Analytics Workspace

### Terraform 実装

```hcl
resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = var.environment == "prod" ? 90 : 30
  daily_quota_gb      = var.environment == "prod" ? -1 : 5 # prod は無制限
  tags                = local.common_tags

  internet_ingestion_enabled = true
  internet_query_enabled     = true
}

# Solutions
resource "azurerm_log_analytics_solution" "container_insights" {
  solution_name         = "ContainerInsights"
  location              = var.location
  resource_group_name   = var.resource_group_name
  workspace_resource_id = azurerm_log_analytics_workspace.main.id
  workspace_name        = azurerm_log_analytics_workspace.main.name

  plan {
    publisher = "Microsoft"
    product   = "OMSGallery/ContainerInsights"
  }
}
```

---

## Diagnostic Settings

### 監視対象リソースと収集項目

| リソース | ログカテゴリ | メトリクス |
|---------|-------------|-----------|
| App Service | AppServiceHTTPLogs, AppServiceConsoleLogs, AppServiceAppLogs | AllMetrics |
| Container Apps | ContainerAppConsoleLogs, ContainerAppSystemLogs | AllMetrics |
| Key Vault | AuditEvent, AzurePolicyEvaluationDetails | AllMetrics |
| SQL Database | SQLSecurityAuditEvents, QueryStoreRuntimeStatistics | AllMetrics |
| NSG | NetworkSecurityGroupEvent, NetworkSecurityGroupRuleCounter | - |
| Azure Firewall | AzureFirewallApplicationRule, AzureFirewallNetworkRule | AllMetrics |
| Front Door | FrontDoorAccessLog, FrontDoorHealthProbeLog | AllMetrics |

### Terraform 実装

```hcl
# App Service の診断設定
resource "azurerm_monitor_diagnostic_setting" "app_service" {
  name                       = "diag-${azurerm_linux_web_app.main.name}"
  target_resource_id         = azurerm_linux_web_app.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AppServiceHTTPLogs"
  }

  enabled_log {
    category = "AppServiceConsoleLogs"
  }

  enabled_log {
    category = "AppServiceAppLogs"
  }

  enabled_log {
    category = "AppServiceAuditLogs"
  }

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

# Key Vault の診断設定
resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name                       = "diag-${azurerm_key_vault.main.name}"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AuditEvent"
  }

  enabled_log {
    category = "AzurePolicyEvaluationDetails"
  }

  metric {
    category = "AllMetrics"
    enabled  = true
  }
}

# 汎用モジュール: 複数リソースに対応
module "diagnostic_settings" {
  source   = "./modules/diagnostic-settings"
  for_each = var.monitored_resources

  resource_id                = each.value.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  log_categories             = each.value.log_categories
  metric_categories          = each.value.metric_categories
}
```

---

## アラートルール

### メトリクスアラート

| アラート名 | リソース | メトリクス | 閾値 | 重大度 |
|-----------|---------|-----------|------|--------|
| 高 CPU | App Service / AKS | CpuPercentage | > 80% 5分間 | Sev2 |
| 高メモリ | App Service / AKS | MemoryPercentage | > 85% 5分間 | Sev2 |
| 応答時間劣化 | App Service | HttpResponseTime | > 5秒 5分間 | Sev2 |
| HTTP 5xx エラー | App Service | Http5xx | > 10 件 5分間 | Sev1 |
| DTU 使用率 | SQL Database | dtu_consumption_percent | > 90% 15分間 | Sev2 |

```hcl
# CPU 使用率アラート
resource "azurerm_monitor_metric_alert" "high_cpu" {
  name                = "alert-high-cpu-${local.name_prefix}"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_linux_web_app.main.id]
  description         = "CPU 使用率が 80% を超えました"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT5M"
  tags                = local.common_tags

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "CpuPercentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.operations.id
  }
}

# HTTP 5xx エラーアラート
resource "azurerm_monitor_metric_alert" "http_5xx" {
  name                = "alert-http-5xx-${local.name_prefix}"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_linux_web_app.main.id]
  description         = "HTTP 5xx エラーが 5分間で 10 件を超えました"
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT5M"
  tags                = local.common_tags

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 10
  }

  action {
    action_group_id = azurerm_monitor_action_group.critical.id
  }
}
```

### ログアラート

| アラート名 | クエリ対象 | 条件 | 重大度 |
|-----------|-----------|------|--------|
| アプリケーション例外 | AppServiceAppLogs | Error レベル > 5件/5分 | Sev2 |
| 認証失敗 | SigninLogs | 失敗 > 10件/15分 | Sev2 |
| Key Vault アクセス異常 | AzureDiagnostics | 403/404 > 5件/5分 | Sev1 |
| リソース削除 | AzureActivity | Delete 操作 | Sev3 |

```hcl
# アプリケーション例外アラート
resource "azurerm_monitor_scheduled_query_rules_alert_v2" "app_errors" {
  name                = "alert-app-errors-${local.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  description         = "アプリケーションエラーが閾値を超えました"
  severity            = 2
  tags                = local.common_tags

  scopes                    = [azurerm_log_analytics_workspace.main.id]
  evaluation_frequency      = "PT5M"
  window_duration           = "PT5M"
  auto_mitigation_enabled   = true
  workspace_alerts_storage_enabled = false

  criteria {
    query = <<-QUERY
      AppServiceAppLogs
      | where Level == "Error" or Level == "Critical"
      | summarize ErrorCount = count() by bin(TimeGenerated, 5m), _ResourceId
    QUERY

    operator                = "GreaterThan"
    threshold               = 5
    time_aggregation_method = "Count"

    failing_periods {
      minimum_failing_periods_to_trigger_alert = 1
      number_of_evaluation_periods             = 1
    }
  }

  action {
    action_groups = [azurerm_monitor_action_group.operations.id]
  }
}
```

### アクティビティログ アラート

```hcl
# リソース削除アラート
resource "azurerm_monitor_activity_log_alert" "resource_deletion" {
  name                = "alert-resource-deletion-${local.name_prefix}"
  resource_group_name = var.resource_group_name
  scopes              = ["/subscriptions/${var.subscription_id}"]
  description         = "本番リソースが削除されました"
  tags                = local.common_tags

  criteria {
    operation_name = "Microsoft.Resources/subscriptions/resourceGroups/delete"
    category       = "Administrative"
    level          = "Critical"
  }

  action {
    action_group_id = azurerm_monitor_action_group.critical.id
  }
}
```

---

## Action Group

```hcl
# 運用チーム向け
resource "azurerm_monitor_action_group" "operations" {
  name                = "ag-operations-${local.name_prefix}"
  resource_group_name = var.resource_group_name
  short_name          = "ops"
  tags                = local.common_tags

  email_receiver {
    name                    = "ops-team"
    email_address           = var.ops_email
    use_common_alert_schema = true
  }
}

# 重大アラート向け
resource "azurerm_monitor_action_group" "critical" {
  name                = "ag-critical-${local.name_prefix}"
  resource_group_name = var.resource_group_name
  short_name          = "critical"
  tags                = local.common_tags

  email_receiver {
    name                    = "ops-team"
    email_address           = var.ops_email
    use_common_alert_schema = true
  }

  sms_receiver {
    name         = "ops-sms"
    country_code = "81"
    phone_number = var.ops_phone
  }

  webhook_receiver {
    name                    = "teams-webhook"
    service_uri             = var.teams_webhook_url
    use_common_alert_schema = true
  }
}
```

---

## Application Insights

### 基本設定

```hcl
resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  retention_in_days   = var.environment == "prod" ? 90 : 30
  sampling_percentage = var.environment == "prod" ? 100 : 50
  tags                = local.common_tags
}
```

### 可用性テスト

```hcl
resource "azurerm_application_insights_standard_web_test" "health_check" {
  name                    = "webtest-health-${local.name_prefix}"
  location                = var.location
  resource_group_name     = var.resource_group_name
  application_insights_id = azurerm_application_insights.main.id
  geo_locations           = ["apac-jp-kaw-edge", "us-va-ash-azr"]
  frequency               = 300 # 5分間隔
  timeout                 = 30
  enabled                 = true
  tags                    = local.common_tags

  request {
    url                              = "https://${var.app_fqdn}/health"
    http_verb                        = "GET"
    parse_dependent_requests_enabled = false
    follow_redirects_enabled         = true
  }

  validation_rules {
    expected_status_code = 200

    content {
      content_match      = "\"status\":\"healthy\""
      pass_if_text_found = true
    }

    ssl_check_enabled       = true
    ssl_cert_remaining_lifetime = 30
  }
}
```

---

## ダッシュボード テンプレート

### 運用ダッシュボード 構成

| セクション | 表示内容 | ウィジェット種別 |
|-----------|---------|---------------|
| サービス正常性 | 可用性テスト結果、HTTP ステータス分布 | タイル + 折れ線グラフ |
| パフォーマンス | 応答時間 p50/p95/p99、スループット | 折れ線グラフ |
| エラー | エラー率推移、上位エラー種別 | 折れ線 + テーブル |
| インフラ | CPU、メモリ、ディスク使用率 | 面グラフ |
| セキュリティ | 認証失敗、Key Vault アクセス | テーブル + カウンター |

### Workbook クエリ例

```kusto
// 応答時間の推移（p50, p95, p99）
requests
| where timestamp > ago(24h)
| summarize
    p50 = percentile(duration, 50),
    p95 = percentile(duration, 95),
    p99 = percentile(duration, 99)
  by bin(timestamp, 5m)
| render timechart

// エラー率の推移
requests
| where timestamp > ago(24h)
| summarize
    TotalCount = count(),
    FailedCount = countif(success == false)
  by bin(timestamp, 5m)
| extend ErrorRate = round(todouble(FailedCount) / todouble(TotalCount) * 100, 2)
| project timestamp, ErrorRate
| render timechart

// 上位エラー種別
exceptions
| where timestamp > ago(24h)
| summarize Count = count() by type, method, outerMessage
| top 10 by Count desc

// Key Vault アクセス監査
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where ResultSignature != "OK"
| summarize Count = count() by OperationName, CallerIPAddress, ResultSignature
| top 20 by Count desc
```

---

## チェックリスト

- [ ] Log Analytics Workspace を作成し保持期間を設定したか
- [ ] すべての重要リソースに Diagnostic Settings を有効化したか
- [ ] メトリクスアラート（CPU、メモリ、エラー率）を設定したか
- [ ] ログアラート（アプリエラー、セキュリティイベント）を設定したか
- [ ] Action Group にメール、SMS、Webhook を設定したか
- [ ] Application Insights を Web アプリに統合したか
- [ ] 可用性テストでヘルスチェックを設定したか
- [ ] 運用ダッシュボード / Workbook を作成したか
- [ ] 本番環境のアラート閾値が適切か確認したか
