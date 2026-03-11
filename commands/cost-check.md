---
name: cost-check
description: Terraform コードのコスト見積もりと最適化提案
---

# /cost-check

## 概要

Terraform コードからデプロイされるリソースのコストを分析し、
月額見積もり、最適化提案、環境間比較を出力するコマンド。

Infracost の出力形式を参考に、Azure 料金体系に基づいたコスト分析を行う。

## 実行フロー

### Phase 1: リソース解析

1. `.tf` ファイルからリソース定義を抽出する
2. 環境別 `.tfvars` からパラメータ（SKU、サイズ等）を特定する
3. `terraform plan -out=tfplan` の出力がある場合はそれを解析する
4. `count` / `for_each` によるリソース数を計算する

### Phase 2: コスト見積もり

以下のリソース種別ごとに月額コストを算出する。

#### コンピュート

| リソース | コスト要素 | 見積もり方法 |
|---------|-----------|-------------|
| App Service Plan | SKU × 時間 | 730 時間/月 |
| Container Apps | vCPU × 時間 + メモリ × 時間 | リクエスト数ベース |
| AKS Node Pool | VM SKU × ノード数 × 時間 | オートスケール考慮 |
| Virtual Machine | VM SKU × 時間 + ディスク | OS ディスク含む |

#### データベース

| リソース | コスト要素 | 見積もり方法 |
|---------|-----------|-------------|
| Azure SQL Database | DTU/vCore × 時間 + ストレージ | ティア別 |
| Cosmos DB | RU/s × 時間 + ストレージ | プロビジョニング or サーバーレス |
| Azure Database for PostgreSQL | vCore × 時間 + ストレージ | Flexible Server |

#### ネットワーク

| リソース | コスト要素 | 見積もり方法 |
|---------|-----------|-------------|
| Azure Firewall | 固定費 + データ処理量 | Standard / Premium |
| Application Gateway | 固定費 + CU × 時間 | v2 SKU |
| VPN Gateway | SKU × 時間 | 帯域幅による |
| Azure Bastion | SKU × 時間 | Basic / Standard |
| Public IP | 固定費 + データ転送量 | Standard SKU |

#### ストレージ / その他

| リソース | コスト要素 | 見積もり方法 |
|---------|-----------|-------------|
| Storage Account | ストレージ量 + トランザクション数 | ティア別 |
| Key Vault | 操作数 | Standard / Premium |
| Log Analytics | データ取り込み量 | GB/日 |
| Application Insights | データ取り込み量 | GB/月 |

### Phase 3: 最適化分析

以下の観点でコスト最適化の余地を特定する。

| 最適化カテゴリ | チェック内容 |
|--------------|-------------|
| 予約インスタンス | 1年/3年予約で削減可能なリソース |
| 適正サイズ | 過剰スペックの SKU がないか |
| 不要リソース | 使用されていない Public IP、ディスク等 |
| ティア選択 | dev 環境で本番用 SKU を使用していないか |
| スケーリング | オートスケール未設定で常時最大構成 |
| ストレージ階層 | Hot 層のみでアーカイブ不使用 |

### Phase 4: レポート生成

## 出力フォーマット

```markdown
# Cost Estimation Report

**対象**: [プロジェクトパス]
**日時**: YYYY-MM-DD HH:MM
**通貨**: JPY（1 USD = XXX JPY で換算）

## 月額コスト サマリー

| 環境 | 月額見積もり | 年額見積もり |
|------|------------|------------|
| dev | ¥XX,XXX | ¥XXX,XXX |
| staging | ¥XX,XXX | ¥XXX,XXX |
| prod | ¥XXX,XXX | ¥X,XXX,XXX |
| **合計** | **¥XXX,XXX** | **¥X,XXX,XXX** |

## リソース別コスト内訳（prod 環境）

| リソース | 種別 | SKU | 数量 | 月額 |
|---------|------|-----|------|------|
| plan-myapp-prod | App Service Plan | P1v3 | 1 | ¥XX,XXX |
| sql-myapp-prod | SQL Database | S2 | 1 | ¥XX,XXX |
| kv-myapp-prod | Key Vault | Standard | 1 | ¥XXX |
| log-myapp-prod | Log Analytics | PerGB2018 | 5 GB/日 | ¥XX,XXX |
| fw-hub-prod | Azure Firewall | Standard | 1 | ¥XXX,XXX |
| ... | ... | ... | ... | ... |

## コスト構成比（円グラフ相当）

| カテゴリ | 月額 | 構成比 |
|---------|------|--------|
| コンピュート | ¥XX,XXX | XX% |
| データベース | ¥XX,XXX | XX% |
| ネットワーク | ¥XX,XXX | XX% |
| ストレージ | ¥XX,XXX | XX% |
| 監視 | ¥XX,XXX | XX% |
| その他 | ¥XX,XXX | XX% |

## 最適化提案

### 削減効果: 高

#### [OPT-001] App Service Plan を予約インスタンスに変更
- **現在**: 従量課金 ¥XX,XXX/月
- **提案**: 1年予約 ¥XX,XXX/月（XX% 削減）
- **年間削減額**: ¥XXX,XXX
- **注意**: 1年間のコミットメントが必要

#### [OPT-002] dev 環境の SKU を B1 に変更
- **現在**: P1v3 ¥XX,XXX/月
- **提案**: B1 ¥X,XXX/月（XX% 削減）
- **月間削減額**: ¥XX,XXX

### 削減効果: 中

#### [OPT-003] Log Analytics のデータ取り込み量を最適化
- **現在**: 5 GB/日
- **提案**: 不要なログカテゴリを無効化 → 3 GB/日
- **月間削減額**: ¥XX,XXX

### 削減効果: 低

(追加の最適化提案)

## Before / After 比較

| 項目 | 現在の月額 | 最適化後の月額 | 削減額 | 削減率 |
|------|-----------|-------------|--------|--------|
| prod | ¥XXX,XXX | ¥XXX,XXX | ¥XX,XXX | XX% |
| dev | ¥XX,XXX | ¥XX,XXX | ¥XX,XXX | XX% |
| staging | ¥XX,XXX | ¥XX,XXX | ¥XX,XXX | XX% |
| **合計** | **¥XXX,XXX** | **¥XXX,XXX** | **¥XX,XXX** | **XX%** |
```

## 使用例

```bash
# 全環境のコスト見積もり
/cost-check

# 特定環境のみ
/cost-check --env prod

# terraform plan 出力を使用
/cost-check --plan tfplan-prod

# 最適化提案のみ表示
/cost-check --optimize-only
```
