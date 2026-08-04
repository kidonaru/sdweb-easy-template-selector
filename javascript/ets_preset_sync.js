// Forge Neo の UI Preset（#forge_ui_preset）を読み、対応するプロファイル名を通知する。
// プロファイルの切り替えそのものは呼び出し側（EasyTemplateSelector）の責務。
class ETSPresetSync {
  // Forge Neo の UI Preset ドロップダウンの elem_id（modules_forge/main_entry.py）
  static ELEMENT_ID = 'forge_ui_preset'

  // 変化検知の唯一の手段。Gradio 4 の Dropdown は値を変えても input へ change を飛ばさない
  // ことを実機（Forge Neo）で確認済みのため、イベントではなくポーリングで見る
  static POLL_INTERVAL_MS = 1000

  // preset が取れない（Forge Neo でない）ときは null を返し、呼び出し側に何もさせない契約
  static resolveProfile(preset, profiles, defaultProfile) {
    if (!preset) {
      return null
    }
    return profiles.includes(preset) ? preset : defaultProfile
  }

  constructor({ getProfiles, getDefaultProfile, onApply }) {
    this.getProfiles = getProfiles
    this.getDefaultProfile = getDefaultProfile
    this.onApply = onApply
    this.started = false
  }

  // UI Preset が読める環境（Forge Neo）か。追従が効く＝手動切替を無効化してよい判定に使う
  static available() {
    return ETSPresetSync.findInput() !== null
  }

  // UI Preset ドロップダウンの入力要素。reForge / A1111 には存在しないので null になりうる。
  // 起動時にまだ無くても後から現れれば拾えるよう、呼ぶたびに引き直す
  static findInput() {
    return gradioApp().getElementById(ETSPresetSync.ELEMENT_ID)?.querySelector('input') || null
  }

  currentPreset() {
    const value = ETSPresetSync.findInput()?.value
    return value ? value.trim() : null
  }

  currentProfile() {
    return ETSPresetSync.resolveProfile(
      this.currentPreset(), this.getProfiles(), this.getDefaultProfile())
  }

  // 監視を開始する。onUiLoaded から 1 回だけ呼ぶ（多重起動の保険として started を見る）
  start() {
    if (this.started) {
      return
    }
    this.started = true
    this.timer = setInterval(() => this.check(), ETSPresetSync.POLL_INTERVAL_MS)
  }

  // 解決結果を毎回渡す。前回値を持たないのは、一括生成中に無視した変更へ
  // 実行終了後に追いつけるようにするため（差分で判定すると二度と通知されない）
  check() {
    const profile = this.currentProfile()
    if (profile) {
      this.onApply(profile)
    }
  }
}
