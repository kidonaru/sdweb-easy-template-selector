// プロンプト欄でのタグ補完（トリガ判定・ポップアップ制御・確定処理）
class ETSCompletion {
  // 補完を配線する textarea と、そこで出す候補の種別
  static TARGETS = [
    { id: 'txt2img_prompt', target: 'positive' },
    { id: 'txt2img_neg_prompt', target: 'negative' },
  ]

  // 行に含まれていたら補完を出さない文字（既存のコメント行と区別するため）
  static STOP_CHARS = /[,()]/

  // カーソル行から補完クエリを取り出す。補完を出さない状況では null を返す
  static extractQuery(value, caret) {
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1
    let lineEnd = value.indexOf('\n', caret)
    if (lineEnd === -1) {
      lineEnd = value.length
    }

    const line = value.slice(lineStart, lineEnd)
    if (!line.startsWith('#')) {
      return null
    }
    if (ETSCompletion.STOP_CHARS.test(line)) {
      return null
    }

    const query = value.slice(lineStart + 1, caret)
    if (query.length < 1) {
      return null
    }

    return { lineStart, lineEnd, query }
  }

  // カーソル行を sectionText で置き換えた結果と、置換後のキャレット位置を返す
  static buildReplacement(value, range, sectionText) {
    const before = value.slice(0, range.lineStart)
    const after = value.slice(range.lineEnd)

    return {
      value: `${before}${sectionText}${after}`,
      caret: range.lineStart + sectionText.length,
    }
  }

  constructor({ ids, history }) {
    this.ids = ids
    this.history = history
    this.index = null
    this.popup = null
    this.entries = []
    this.selectedIndex = 0
    this.textarea = null
    this.composing = false
    this.attached = false
  }

  setIndex(index) {
    this.index = index
  }

  // イベント配線。init() は Reload のたびに走るので二重配線を防ぐ。
  // 配線に失敗したときは attached を立てず、次の Reload でやり直せるようにする
  attach() {
    if (this.attached) {
      return
    }

    const targets = []
    for (const { id, target } of ETSCompletion.TARGETS) {
      const textarea = gradioApp().getElementById(id)?.querySelector('textarea')
      if (!textarea) {
        console.error(`補完の配線に失敗しました: ${id} の textarea が見つかりません`)
        return
      }
      targets.push({ textarea, target })
    }

    for (const { textarea, target } of targets) {
      textarea.addEventListener('input', () => this.refresh(textarea, target))
      textarea.addEventListener('click', () => this.refresh(textarea, target))
      textarea.addEventListener('keyup', (event) => {
        // カーソル移動だけでも判定し直す
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          this.refresh(textarea, target)
        }
      })
      textarea.addEventListener('blur', () => this.close())
      textarea.addEventListener('compositionstart', () => { this.composing = true })
      textarea.addEventListener('compositionend', () => { this.composing = false })
    }

    // keydown は祖先の捕捉フェーズで受ける。
    // textarea 自身に登録すると eventPhase が AT_TARGET になり、capture を付けても
    // 登録順でしか呼ばれず、tagcomplete より先に処理できる保証がないため
    gradioApp().addEventListener('keydown', (event) => this.onKeyDown(event), true)

    // position: fixed なのでスクロール・リサイズには追従しない。ずれるより閉じる
    window.addEventListener('scroll', () => this.close(), true)
    window.addEventListener('resize', () => this.close())

    this.attached = true
  }

  isOpen() {
    return this.popup !== null && this.popup.style.display !== 'none'
  }

  // 現在のカーソル位置から候補を引き直し、ポップアップを開閉する
  refresh(textarea, target) {
    if (!this.index) {
      this.close()
      return
    }

    const range = ETSCompletion.extractQuery(textarea.value, textarea.selectionStart)
    if (!range) {
      this.close()
      return
    }

    const entries = this.index.search(range.query, target)
    if (entries.length === 0) {
      this.close()
      return
    }

    this.textarea = textarea
    this.entries = entries
    this.selectedIndex = 0
    this.open()
  }

  open() {
    if (!this.popup) {
      this.popup = ETSElementBuilder.completionPopup(this.ids.COMPLETION_POPUP)
      // テーマの CSS 変数を解決させるため gradio コンテナ配下に置く
      const parent = gradioApp().querySelector('.gradio-container') ?? document.body
      parent.appendChild(this.popup)
    }

    this.renderItems()
    this.popup.style.display = 'block'
    this.updatePosition()
  }

  close() {
    if (this.popup) {
      this.popup.style.display = 'none'
    }
    this.entries = []
    this.selectedIndex = 0
  }

  renderItems() {
    this.popup.replaceChildren()

    this.entries.forEach((entry, index) => {
      const item = ETSElementBuilder.completionItem(entry, index === this.selectedIndex, {
        onSelect: () => {
          this.selectedIndex = index
          this.confirm()
        },
        onHover: () => this.select(index),
      })
      this.popup.appendChild(item)
    })
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      return
    }

    this.selectedIndex = index
    this.popup.querySelectorAll('.easy_template_completion_item').forEach((item, i) => {
      item.classList.toggle('selected', i === index)
    })
    this.popup.children[index]?.scrollIntoView({ block: 'nearest' })
  }

  // 候補を上下に移動する。端では折り返す
  move(delta) {
    const count = this.entries.length
    if (count === 0) {
      return
    }

    this.select((this.selectedIndex + delta + count) % count)
  }

  // textarea の直下に左寄せで置く（ビューポート座標）
  updatePosition() {
    const rect = this.textarea.getBoundingClientRect()
    this.popup.style.left = `${rect.left}px`
    this.popup.style.top = `${rect.bottom}px`
    this.popup.style.minWidth = `${rect.width}px`
  }

  onKeyDown(event) {
    if (!this.isOpen() || event.target !== this.textarea) {
      return
    }

    // IME 変換中のキーは変換操作なので素通しする。
    // isComposing だけでは取りこぼす環境があるため keyCode 229 と自前のフラグも見る
    if (event.isComposing || event.keyCode === 229 || this.composing) {
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        this.move(1)
        break
      case 'ArrowUp':
        this.move(-1)
        break
      case 'Enter':
      case 'Tab':
        this.confirm()
        break
      case 'Escape':
        this.close()
        break
      default:
        return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  // 選択中の候補でカーソル行を置き換える
  confirm() {
    const entry = this.entries[this.selectedIndex]
    const textarea = this.textarea
    if (!entry || !textarea) {
      this.close()
      return
    }

    const range = ETSCompletion.extractQuery(textarea.value, textarea.selectionStart)
    if (!range) {
      this.close()
      return
    }

    const section = new ETSSection(entry.comment, entry.tag, entry.category).toString()
    const replacement = ETSCompletion.buildReplacement(textarea.value, range, section)

    this.close()

    // setSelectionRange を updateInput より先に呼ぶ。
    // updateInput が投げる input イベントで refresh() が走るため、
    // その時点でキャレットが挿入位置に無いと古いクエリのまま開き直すことがある
    textarea.value = replacement.value
    textarea.focus()
    textarea.setSelectionRange(replacement.caret, replacement.caret)
    updateInput(textarea)

    this.history.saveTextHistory()
  }
}
