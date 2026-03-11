# Intune Policy スキル

Microsoft Intune によるデバイス管理テンプレート。デバイスコンプライアンスポリシー、
構成プロファイル、アプリ保護ポリシー（MAM）、および条件付きアクセス連携を実装する。

---

## トリガー

以下のいずれかに該当する場合にこのスキルを使用する。

- デバイスコンプライアンスポリシーを設計する
- デバイス構成プロファイルを作成する
- アプリ保護ポリシー（MAM）を設定する
- Intune と条件付きアクセスを連携する
- デバイス登録の構成を行う

---

## デバイスコンプライアンスポリシー

### Windows コンプライアンス

| 設定項目 | 要件 | 非準拠時の動作 |
|---------|------|---------------|
| BitLocker | 有効必須 | 即時非準拠 |
| ウイルス対策 | Windows Defender 有効 | 即時非準拠 |
| OS バージョン | 最小: Windows 11 23H2 | 24時間猶予 |
| ファイアウォール | 有効必須 | 即時非準拠 |
| TPM | バージョン 2.0 以上 | 即時非準拠 |
| パスワード | 8文字以上、複雑性必須 | 24時間猶予 |

### Terraform 実装（Microsoft Graph API 経由）

```hcl
# Windows コンプライアンスポリシー
resource "microsoft365_device_compliance_policy" "windows" {
  display_name = "Windows コンプライアンスポリシー"
  description  = "企業 Windows デバイスの最低セキュリティ基準"

  # BitLocker 必須
  require_bitlocker = true

  # ウイルス対策必須
  antivirus_required    = true
  antispyware_required  = true
  real_time_protection  = true

  # ファイアウォール必須
  firewall_enabled = true

  # OS バージョン
  os_minimum_version = "10.0.22631" # Windows 11 23H2

  # パスワード要件
  password_required             = true
  password_minimum_length       = 8
  password_required_type        = "alphanumeric"
  password_minutes_of_inactivity_before_lock = 15

  # TPM
  tpm_required = true

  # 非準拠時のアクション
  action_for_noncompliance {
    action                        = "notify"
    grace_period_hours            = 0
    notification_template_id      = var.notification_template_id
    notification_message_template = "デバイスが企業ポリシーに準拠していません。"
  }

  action_for_noncompliance {
    action             = "block"
    grace_period_hours = 24
  }
}
```

### iOS/Android コンプライアンス

| プラットフォーム | 設定項目 | 要件 |
|---------------|---------|------|
| iOS | 暗号化 | 有効必須 |
| iOS | Jailbreak 検出 | ブロック |
| iOS | OS バージョン | 最小 iOS 17 |
| Android | 暗号化 | 有効必須 |
| Android | Root 検出 | ブロック |
| Android | OS バージョン | 最小 Android 14 |
| 共通 | パスコード | 6桁以上 |
| 共通 | 紛失モード | 有効 |

```hcl
# iOS コンプライアンスポリシー
resource "microsoft365_device_compliance_policy" "ios" {
  display_name = "iOS コンプライアンスポリシー"

  os_minimum_version     = "17.0"
  security_block_jailbroken_devices = true
  managed_email_profile_required    = true
  passcode_required                 = true
  passcode_minimum_length           = 6
  device_threat_protection_required_security_level = "secured"

  action_for_noncompliance {
    action             = "block"
    grace_period_hours = 0
  }
}
```

---

## 構成プロファイル

### Wi-Fi プロファイル

```hcl
resource "microsoft365_device_configuration_profile" "wifi_corporate" {
  display_name = "企業 Wi-Fi プロファイル"
  platform     = "windows10AndLater"

  wifi {
    network_name             = var.corporate_wifi_ssid
    ssid                     = var.corporate_wifi_ssid
    connect_automatically    = true
    security_type            = "wpa2Enterprise"
    authentication_method    = "certificate"
    eap_type                 = "eapTls"
    trusted_server_certificate_names = var.radius_server_cert_names
  }
}
```

### VPN プロファイル

```hcl
resource "microsoft365_device_configuration_profile" "vpn_always_on" {
  display_name = "Always-On VPN プロファイル"
  platform     = "windows10AndLater"

  vpn {
    connection_name = "Corporate VPN"
    connection_type = "ikEv2"
    server_address  = var.vpn_gateway_fqdn

    always_on           = true
    split_tunneling     = true
    dns_suffix_search_list = [var.corporate_dns_suffix]

    authentication_method = "certificate"
  }
}
```

### Windows Update リング

```hcl
resource "microsoft365_windows_update_ring" "standard" {
  display_name = "標準 Windows Update リング"

  # 品質更新プログラム
  quality_update_deferral_period_in_days = 7    # 7日延期
  quality_update_pause_period_in_days    = 0

  # 機能更新プログラム
  feature_update_deferral_period_in_days = 30   # 30日延期
  feature_update_pause_period_in_days    = 0

  # インストールスケジュール
  automatic_update_mode       = "autoInstallAtMaintenanceTime"
  active_hours_start          = "08:00"
  active_hours_end            = "17:00"
  maintenance_window_start    = "02:00"

  # 再起動設定
  restart_notification_snooze = "PT4H"
  deadline_for_feature_updates_in_days = 7
  deadline_for_quality_updates_in_days = 3
}

resource "microsoft365_windows_update_ring" "pilot" {
  display_name = "パイロット Windows Update リング"

  # パイロットグループは延期なし
  quality_update_deferral_period_in_days = 0
  feature_update_deferral_period_in_days = 0

  automatic_update_mode = "autoInstallAtMaintenanceTime"
}
```

### セキュリティベースライン

| カテゴリ | 設定 | 値 |
|---------|------|-----|
| BitLocker | ドライブ暗号化方式 | XTS-AES 256 |
| Windows Defender | リアルタイム保護 | 有効 |
| Windows Defender | クラウド保護 | 有効 |
| ファイアウォール | ドメインプロファイル | 有効 |
| ファイアウォール | プライベートプロファイル | 有効 |
| ファイアウォール | パブリックプロファイル | 有効 |
| Edge | SmartScreen | 有効 |
| Edge | パスワードマネージャー | 無効（企業 SSO を使用） |
| UAC | 管理者承認モード | 有効 |

---

## アプリ保護ポリシー（MAM）

### データ保護設定

```
┌───────────────────────────────────────────────┐
│              MAM ポリシー境界                  │
│                                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │ Outlook │  │ Teams   │  │OneDrive │      │
│  └────┬────┘  └────┬────┘  └────┬────┘      │
│       │            │            │            │
│       └──── 企業データ ─────────┘            │
│              コピー/共有 OK                    │
│                                               │
│       ✕ 個人アプリへのコピー/共有をブロック    │
│       ✕ スクリーンショットをブロック           │
│       ✕ バックアップ先を制限                   │
└───────────────────────────────────────────────┘
```

| 設定項目 | 値 | 説明 |
|---------|-----|------|
| 企業データの暗号化 | 必須 | アプリ内データの暗号化 |
| コピー＆ペースト | マネージドアプリのみ | 個人アプリへのコピーをブロック |
| 「名前を付けて保存」 | OneDrive for Business のみ | 個人ストレージへの保存をブロック |
| PIN 要件 | 6桁以上 | アプリ起動時に PIN |
| 生体認証 | 許可 | PIN の代替として生体認証を許可 |
| オフラインアクセス | 24時間 | オフラインでのデータアクセス上限 |
| Jailbreak/Root 検出 | ブロック | 改変デバイスでのアクセスを禁止 |
| 最小 OS バージョン | プラットフォーム依存 | 古い OS でのアクセスを制限 |

### Terraform 実装例

```hcl
resource "microsoft365_app_protection_policy" "ios_mam" {
  display_name = "iOS アプリ保護ポリシー"
  platform     = "ios"

  apps = [
    "com.microsoft.Office.Outlook",
    "com.microsoft.teams",
    "com.microsoft.skydrive",
    "com.microsoft.Office.Excel",
    "com.microsoft.Office.Word",
    "com.microsoft.Office.PowerPoint",
  ]

  # データ保護
  data_backup_blocked                     = true
  device_compliance_required              = false  # MAM-only シナリオ
  managed_browser_required                = true
  save_as_blocked                         = true
  allowed_outbound_data_transfer_destinations = "managedApps"
  allowed_inbound_data_transfer_sources       = "managedApps"
  organizational_credentials_required         = true
  contact_sync_blocked                        = true
  print_blocked                               = true

  # アクセス要件
  pin_required           = true
  minimum_pin_length     = 6
  fingerprint_blocked    = false  # 生体認証を許可
  simple_pin_blocked     = true

  # 条件付き起動
  max_pin_retry      = 5
  offline_grace_period = "P1D"  # 24時間
  jailbreak_blocked   = true
  min_os_version      = "17.0"
}
```

---

## 条件付きアクセス連携

### デバイス準拠 + アプリ保護の組み合わせ

```
サインイン試行
    │
    ├─ 管理デバイス（MDM 登録済み）
    │     └─ コンプライアンスポリシーで評価
    │          ├─ 準拠 → アクセス許可
    │          └─ 非準拠 → アクセスブロック
    │
    └─ 非管理デバイス（BYOD）
          └─ アプリ保護ポリシー（MAM）で評価
               ├─ MAM 対応アプリ → データ保護下でアクセス許可
               └─ 非対応アプリ → アクセスブロック
```

---

## デバイス登録構成

### 登録方式の選択

| 方式 | 対象 | ユーザー操作 | 管理レベル |
|------|------|-------------|-----------|
| Azure AD Join | 企業デバイス | OOBE で自動 | フル管理 |
| Azure AD Register | BYOD | ユーザーが手動登録 | アプリ単位 |
| Autopilot | 新規デバイス | ゼロタッチ | フル管理 |
| 一括登録 | キオスク/共有 | 管理者がプロビジョニング | フル管理 |

### Autopilot 推奨設定

| 項目 | 設定 |
|------|------|
| デプロイモード | User-Driven |
| Join タイプ | Azure AD Join |
| OOBE スキップ | EULA、プライバシー設定、カスタマイズ設定 |
| アカウント種別 | Standard User（管理者にしない） |
| 登録ステータスページ | 有効（タイムアウト 60分） |

---

## チェックリスト

- [ ] Windows コンプライアンスポリシーで BitLocker とウイルス対策を必須にしたか
- [ ] iOS/Android で Jailbreak/Root 検出を有効にしたか
- [ ] Windows Update リングでパイロットグループを先行展開したか
- [ ] MAM ポリシーで企業データの個人アプリへの流出を防止したか
- [ ] 条件付きアクセスでデバイス準拠を要件にしたか
- [ ] BYOD 向けに MAM-only シナリオを用意したか
- [ ] Autopilot プロファイルで Standard User を指定したか
- [ ] 非準拠時の猶予期間とアクションを定義したか
