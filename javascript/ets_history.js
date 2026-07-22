// プロンプトテキストの Undo/Redo 履歴管理
class ETSHistory {
  constructor({ ids }) {
    this.ids = ids
    this.textHistory = []
    this.currentHistoryIndex = -1
    this.maxHistoryLength = 20
  }

  undoLastAction() {
    if (this.currentHistoryIndex > 0) {
      this.restoreFromHistory(this.currentHistoryIndex - 1)
      this.updateUndoRedoButtons()
    }
  }

  redoLastAction() {
    if (this.currentHistoryIndex < this.textHistory.length - 1) {
      this.restoreFromHistory(this.currentHistoryIndex + 1)
      this.updateUndoRedoButtons()
    }
  }

  // テキスト履歴を保存するメソッド
  saveTextHistory() {
    const textarea = gradioApp().getElementById('txt2img_prompt').querySelector('textarea')
    const negTextarea = gradioApp().getElementById('txt2img_neg_prompt').querySelector('textarea')

    const currentState = {
      prompt: textarea.value,
      negPrompt: negTextarea.value
    }

    // 現在の位置より後の履歴を削除
    if (this.currentHistoryIndex < this.textHistory.length - 1) {
      this.textHistory = this.textHistory.slice(0, this.currentHistoryIndex + 1)
    }

    // 新しい状態を追加
    this.textHistory.push(currentState)

    // 履歴の長さを制限
    if (this.textHistory.length > this.maxHistoryLength) {
      this.textHistory.shift()
    } else {
      this.currentHistoryIndex++
    }

    this.updateUndoRedoButtons()
  }

  resetTextHistory() {
    this.textHistory = []
    this.currentHistoryIndex = -1
    this.updateUndoRedoButtons()
  }

  // 履歴から状態を復元するメソッド
  restoreFromHistory(index) {
    if (index < 0 || index >= this.textHistory.length) return

    const state = this.textHistory[index]
    const textarea = gradioApp().getElementById('txt2img_prompt').querySelector('textarea')
    const negTextarea = gradioApp().getElementById('txt2img_neg_prompt').querySelector('textarea')

    textarea.value = state.prompt
    negTextarea.value = state.negPrompt

    updateInput(textarea)
    updateInput(negTextarea)

    this.currentHistoryIndex = index
  }

  // undo/redoボタンの更新
  updateUndoRedoButtons() {
    const undoButton = gradioApp().querySelector(`#${this.ids.UNDO_BUTTON}`)
    const redoButton = gradioApp().querySelector(`#${this.ids.REDO_BUTTON}`)

    if (undoButton) {
      undoButton.disabled = this.currentHistoryIndex <= 0
    }
    if (redoButton) {
      redoButton.disabled = this.currentHistoryIndex >= this.textHistory.length - 1
    }
  }
}
