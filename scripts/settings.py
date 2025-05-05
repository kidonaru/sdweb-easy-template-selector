from modules import script_callbacks, shared

def on_ui_settings():
    shared.opts.add_option("easy_template_enable_save_raw_prompt_to_pnginfo", shared.OptionInfo(False, "元プロンプトを pngninfo に保存する", section=("easy_template_selector", "Easy Template Selector")))
    shared.opts.add_option("easy_template_remove_blank_line", shared.OptionInfo(True, "出力時に空行を削除する", section=("easy_template_selector", "Easy Template Selector")))
    shared.opts.add_option("easy_template_remove_new_line", shared.OptionInfo(False, "出力時に改行を削除する", section=("easy_template_selector", "Easy Template Selector")))
    shared.opts.add_option("easy_template_use_consistent_seed", shared.OptionInfo(True, "Seed値を各tag間で固定する", section=("easy_template_selector", "Easy Template Selector")))

script_callbacks.on_ui_settings(on_ui_settings)
