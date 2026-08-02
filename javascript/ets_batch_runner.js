// タグセクションを差し替えながら複数テンプレートを順次生成するバッチ実行
class ETSBatchRunner {
  // 差し替え対象外のカテゴリ。テンプレ本体は選択の扱いが別なので帯を持たせない
  static NON_SWAP_CATEGORY_PREFIX = '00_'
  // 90 番台以降（モデル・解像度・Color・特殊・ネガティブ）はテキスト挿入以外の副作用を持つため対象外
  static NON_SWAP_BAND_MIN = 90

  // 待機・再試行の調整値。実機の応答時間に合わせて調整するのでここに集約する
  static TIMINGS = {
    // 既定のポーリング間隔
    POLL_INTERVAL_MS: 500,
    // テンプレ本体のメタ反映タイマー（ets_template_manager.js: 1500ms）に余裕を持たせた待機
    META_REFLECT_DELAY_MS: 2000,
    // pnginfo 貼り付けの非同期書き戻しが落ち着くまでの上限
    PROMPT_QUIESCENCE_TIMEOUT_MS: 60 * 1000,
    // 静穏と見なすまでの「値が変化しなかった」連続ポーリング回数
    QUIESCENCE_STABLE_COUNT: 3,
    // モデル（checkpoint）ロード完了までの上限
    MODEL_LOAD_TIMEOUT_MS: 5 * 60 * 1000,
    // モデルロード直後の UI 更新の猶予
    MODEL_LOAD_SETTLE_DELAY_MS: 1000,
    // 差し替えが遅延書き戻しで消された場合の再試行回数と間隔
    SWAP_RETRY_ATTEMPTS: 5,
    SWAP_RETRY_INTERVAL_MS: 1500,
    // Generate クリックから生成開始（Interrupt 表示）までの上限
    GENERATE_START_TIMEOUT_MS: 30 * 1000,
    // 生成完了（Interrupt 非表示）までの上限
    GENERATE_FINISH_TIMEOUT_MS: 15 * 60 * 1000,
  }

  // カテゴリが属する差し替え帯（先頭の番号）。対象外は null。
  // 10_キャラ と 10_キャラ_ブルアカ のように番号が同じカテゴリは同じ帯にまとまる
  static bandOf(category) {
    if (!category || category.startsWith(ETSBatchRunner.NON_SWAP_CATEGORY_PREFIX)) {
      return null
    }
    // カテゴリは 'ファイル名:グループ' 形式なので、帯の判定はファイル名側だけを見る
    const band = category.split(':')[0].match(/^\d+/)?.[0]
    if (!band || Number(band) >= ETSBatchRunner.NON_SWAP_BAND_MIN) {
      return null
    }
    return band
  }

  // セクションのカテゴリが差し替え対象か
  static isSwapTarget(editor, sectionText) {
    return ETSBatchRunner.bandOf(editor.parseSection(sectionText).category) !== null
  }

  // プロンプトから差し替え対象セクションを出現順に抽出する
  static extractSwapSections(editor, promptText) {
    return editor.splitSections(promptText)
      .filter((section) => ETSBatchRunner.isSwapTarget(editor, section))
  }

  // セクション文字列の配列を帯ごとの抽選プールにまとめる
  static groupByBand(editor, sectionTexts) {
    const pools = new Map()
    for (const section of sectionTexts) {
      const band = ETSBatchRunner.bandOf(editor.parseSection(section).category)
      if (!band) {
        continue
      }
      if (!pools.has(band)) {
        pools.set(band, [])
      }
      pools.get(band).push(section)
    }
    return pools
  }

  // 帯ごとに 1 件ずつ抽選する。乱数源は単体テストのために差し替え可能にしている
  static pickSwapSections(pools, random = Math.random) {
    const picked = new Map()
    for (const [band, sections] of pools) {
      picked.set(band, sections[Math.floor(random() * sections.length)])
    }
    return picked
  }

  // picked のうち、テンプレに同じ帯のセクションがあって実際に挿入されるものだけを返す
  static applicableSections(editor, templatePrompt, picked) {
    const bands = new Set(
      ETSBatchRunner.extractSwapSections(editor, templatePrompt)
        .map((section) => ETSBatchRunner.bandOf(editor.parseSection(section).category))
    )
    return Array.from(picked)
      .filter(([band]) => bands.has(band))
      .map(([, section]) => section)
  }

  // テンプレのプロンプトを帯単位で差し替える。
  // 帯ごとに最初の出現位置だけを picked の内容へ置き換え、2 件目以降はそのまま残す。
  // テンプレに存在しない帯は挿入せず、picked に無い帯のセクションもそのまま残す
  static swapSections(editor, templatePrompt, picked) {
    if (picked.size === 0) {
      return templatePrompt
    }

    const usedBands = new Set()
    return editor.splitSections(templatePrompt).map((section) => {
      const band = ETSBatchRunner.bandOf(editor.parseSection(section).category)
      if (!band || !picked.has(band) || usedBands.has(band)) {
        return section
      }
      usedBands.add(band)
      return picked.get(band)
    }).join('\n')
  }

  constructor({ promptEditor, templateManager, onProgress }) {
    this.promptEditor = promptEditor
    this.templateManager = templateManager
    this.onProgress = onProgress || (() => {})
    this.running = false
    this.stopRequested = false
    this.progressPrefix = ''
  }

  // ミリ秒待つ
  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // predicate が true になるまでポーリングする。タイムアウトで false を返す
  static async waitFor(predicate, timeoutMs, intervalMs = ETSBatchRunner.TIMINGS.POLL_INTERVAL_MS) {
    const limit = Date.now() + timeoutMs
    while (Date.now() < limit) {
      if (predicate()) {
        return true
      }
      await ETSBatchRunner.delay(intervalMs)
    }
    return false
  }

  // Interrupt ボタンが表示中（= 生成中）か
  static isGenerating() {
    const interrupt = gradioApp().getElementById('txt2img_interrupt')
    return !!interrupt && getComputedStyle(interrupt).display !== 'none'
  }

  // ポジティブプロンプトの textarea。Gradio の再描画中などで取れなければ例外を投げる
  getPromptTextarea() {
    const textarea = gradioApp().getElementById('txt2img_prompt')?.querySelector('textarea')
    if (!textarea) {
      throw new Error('プロンプト欄 (txt2img_prompt) が見つかりません')
    }
    return textarea
  }

  // waitFor のタイムアウトを失敗ログつきで扱う。成功で true
  async waitOrFail(predicate, timeoutMs, item, failMessage) {
    const ok = await ETSBatchRunner.waitFor(predicate, timeoutMs)
    if (!ok) {
      console.error(`一括生成: ${failMessage} (${item.name})`)
    }
    return ok
  }

  // 停止要求。現在の生成完了後にループを打ち切る
  stop() {
    if (!this.running) {
      return
    }
    this.stopRequested = true
    this.onProgress('停止要求中…（現在の生成完了後に停止）')
  }

  // 選択テンプレを順次生成する。swapSectionTexts は選択されたタグのセクション文字列
  async start(items, swapSectionTexts) {
    if (this.running) {
      return { success: 0, failure: 0 }
    }
    this.running = true
    this.stopRequested = false

    let success = 0
    let failure = 0
    // ここで抜けると running が立ったままになり、実行中ガードで拡張全体が操作不能になる
    try {
      // 差し替え元は帯ごとの抽選プールにしておき、テンプレごとに引き直す
      const pools = ETSBatchRunner.groupByBand(this.promptEditor, swapSectionTexts || [])

      for (let i = 0; i < items.length; i++) {
        if (this.stopRequested) {
          break
        }
        const item = items[i]
        this.progressPrefix = `${i + 1}/${items.length}: ${item.name}`
        this.onProgress(this.progressPrefix)
        const ok = await this.runOne(item, pools)
        ok ? success++ : failure++
      }
      const suffix = this.stopRequested ? '（停止）' : ''
      this.onProgress(`完了${suffix}: 成功 ${success} 件 / 失敗 ${failure} 件`)
    } catch (error) {
      console.error('一括生成: 実行を中断しました', error)
      this.onProgress(`中断: ${error.message}`)
    } finally {
      this.running = false
    }
    return { success, failure }
  }

  // プロンプト欄の書き戻しが落ち着く（連続 3 回のポーリングで値が変化しない）まで待つ
  async waitForPromptQuiescence(timeoutMs) {
    const textarea = this.getPromptTextarea()
    let last = null
    let stableCount = 0
    return ETSBatchRunner.waitFor(() => {
      if (textarea.value === last) {
        stableCount++
      } else {
        stableCount = 0
        last = textarea.value
      }
      return stableCount >= ETSBatchRunner.TIMINGS.QUIESCENCE_STABLE_COUNT
    }, timeoutMs)
  }

  // 1 テンプレ分の適用・差し替え・生成を行う。成功で true
  async runOne(item, pools) {
    try {
      const parsed = this.templateManager.parseMetaText(item.template)
      // 抽選はテンプレごとに引き直す。テンプレに存在しない帯は挿入されない
      const picked = ETSBatchRunner.pickSwapSections(pools)
      const applicable = ETSBatchRunner.applicableSections(this.promptEditor, parsed.prompt, picked)
      if (applicable.length > 0) {
        // どの組み合わせを引いたかを進捗に出す（生成画像の infotext と突き合わせられるように）
        const labels = applicable.map((section) => this.promptEditor.parseSection(section).comment)
        this.onProgress(`${this.progressPrefix} ← ${labels.join(' / ')}`)
      }

      const timings = ETSBatchRunner.TIMINGS

      this.templateManager.applyTemplate(item.template, item.name)

      // テンプレ本体のメタ反映タイマー（ets_template_manager.js: 1500ms）に余裕を持たせて待つ
      await ETSBatchRunner.delay(timings.META_REFLECT_DELAY_MS)

      // pnginfo 貼り付けの非同期書き戻しが落ち着くまで待つ（固定待ちではなく静穏検知）
      const settled = await this.waitForPromptQuiescence(timings.PROMPT_QUIESCENCE_TIMEOUT_MS)
      if (!settled) {
        console.error(`一括生成: テンプレ適用の書き戻しが安定しませんでした (${item.name})`)
        return false
      }

      // モデル切替が必要な場合はロード完了を待つ
      const modelName = parsed.metaDataMap['Model']
      if (this.templateManager.applyModel && modelName) {
        const loaded = await this.waitOrFail(
          () => this.templateManager.getCurrentModel() === modelName,
          timings.MODEL_LOAD_TIMEOUT_MS, item, 'モデル切替がタイムアウトしました')
        if (!loaded) {
          return false
        }
        // ロード直後の UI 更新の猶予
        await ETSBatchRunner.delay(timings.MODEL_LOAD_SETTLE_DELAY_MS)
      }

      // 選択したタグのセクションを差し替える。遅延書き戻しで消えた場合に備えて反映確認つきで再試行し、
      // 最終的に反映できなければ失敗として次のテンプレへ進む（元キャラのままサイレント生成しない）
      if (applicable.length > 0) {
        let applied = false
        for (let attempt = 0; attempt < timings.SWAP_RETRY_ATTEMPTS; attempt++) {
          this.applySwap(picked)
          await ETSBatchRunner.delay(timings.SWAP_RETRY_INTERVAL_MS)
          if (this.isSwapApplied(applicable)) {
            applied = true
            break
          }
        }
        if (!applied) {
          console.error(`一括生成: タグの差し替えが反映できませんでした (${item.name})`)
          return false
        }
      }

      // 生成開始
      const generateButton = gradioApp().getElementById('txt2img_generate')
      if (!generateButton) {
        console.error(`一括生成: Generate ボタンが見つかりません (${item.name})`)
        return false
      }

      // クリック直前にもう一度確認する。静穏検知は「まだ書き戻しが始まっていない」状態も
      // 静穏と見なしうるため、遅れて到着した書き戻しで差し替えが消えている可能性がある
      if (applicable.length > 0 && !this.isSwapApplied(applicable)) {
        console.error(`一括生成: 生成直前に差し替えが失われていました (${item.name})`)
        return false
      }

      generateButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))

      // 生成開始（Interrupt 表示）を待つ
      const started = await this.waitOrFail(() => ETSBatchRunner.isGenerating(),
        timings.GENERATE_START_TIMEOUT_MS, item, '生成が開始されませんでした')
      if (!started) {
        return false
      }

      // 生成完了（Interrupt 非表示）を待つ
      const finished = await this.waitOrFail(() => !ETSBatchRunner.isGenerating(),
        timings.GENERATE_FINISH_TIMEOUT_MS, item, '生成完了がタイムアウトしました')
      return finished
    } catch (error) {
      console.error(`一括生成: エラーが発生しました (${item.name})`, error)
      return false
    }
  }

  // プロンプト欄へ差し替えを適用する
  applySwap(picked) {
    if (picked.size === 0) {
      return
    }
    const textarea = this.getPromptTextarea()
    const swapped = ETSBatchRunner.swapSections(this.promptEditor, textarea.value, picked)
    if (swapped !== textarea.value) {
      textarea.value = swapped
      updateInput(textarea)
    }
  }

  // 差し替えが反映済みか（実際に挿入されるはずのセクションがすべてプロンプト欄にあること）
  isSwapApplied(applicableSections) {
    const value = this.getPromptTextarea().value
    return applicableSections.every((section) => value.includes(section))
  }
}
