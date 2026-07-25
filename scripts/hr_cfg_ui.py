"""Hires CFG Scale の 0 センチネルを UI 上で扱えるようにする

Forge Neo の Hires CFG Scale スライダーは下限 1.0 で定義されており（本体 modules/ui.py:265）、
Gradio 4.40 のフロントエンドは blur 時にこの下限までクランプする。そのため
reForge 互換のセンチネル値 0 をテンプレートから流し込んでも、ユーザーが入力欄に触れた
だけで 1.0 に丸められ、scripts/hr_cfg_inherit.py の継承が発動しなくなる。

Slider は preprocess / postprocess のどちらでもクランプしないため、minimum を
書き換えても生成側への副作用は無い。

書き換えのタイミングが on_app_started なのは、本体の ui_loadsave が UI 構築中に
ui-config.json の minimum を書き戻すため（本体 modules/ui_loadsave.py:96 の
apply_field(x, "minimum")）。on_after_component で書き換えても直後に上書きされる。

ただし Gradio 4.40 はフロントへ渡す config を Blocks.queue() / launch() の時点で
Blocks.config にキャッシュし、ページ配信時はそれを使い回す（gradio/routes.py:385）。
属性を書き換えるだけでは反映されないため、書き換え後に get_config_file() で
キャッシュを作り直す。
"""

import gradio as gr

from modules import script_callbacks, shared

from scripts.hr_cfg_inherit import is_hr_negative_interactive

# 本体 modules/ui.py:265 で定義されている txt2img 側の Hires CFG Scale スライダー
# （img2img には Hires.fix が無いため対象は txt2img のみ）
HR_CFG_ELEM_ID = 'txt2img_hr_cfg'

# 緩和後の下限。センチネル値 0 を保持できるようにするためだけの値
RELAXED_MINIMUM = 0.0

# 差し替え対象の本体側の関数名（本体 modules/ui.py:61）
TARGET_FN_NAME = 'use_cfg'

_hr_cfg_component = None

# config キャッシュを作り直すために保持する Blocks
_demo = None

# ui_loadsave による書き戻し後の下限。設定を OFF に戻すときの復元先として使う
_original_minimum = None


def _capture_hr_cfg(component, **kwargs):
    """下限を書き換える対象のスライダーを覚えておく"""
    global _hr_cfg_component

    if getattr(component, 'elem_id', None) == HR_CFG_ELEM_ID:
        _hr_cfg_component = component


def _apply_minimum():
    """設定に応じて Hires CFG Scale スライダーの下限を切り替える"""
    global _original_minimum

    if _hr_cfg_component is None:
        print(f'[Easy Template Selector] {HR_CFG_ELEM_ID} が見つからないため'
              ' Hires CFG Scale の下限緩和を見送りました')
        return

    if _original_minimum is None:
        # ui_loadsave の書き戻しが済んだ後の値を本来の下限として記憶する
        _original_minimum = _hr_cfg_component.minimum

    if shared.opts.easy_template_inherit_hr_cfg:
        _hr_cfg_component.minimum = RELAXED_MINIMUM
    else:
        _hr_cfg_component.minimum = _original_minimum

    # 属性を書き換えただけではフロントに届かないため、config キャッシュを作り直す
    if _demo is not None:
        _demo.config = _demo.get_config_file()


def _on_app_started(demo, app):
    global _demo

    # --nowebui では UI が構築されないため何もしない（本体 webui.py:62）
    if demo is None:
        return

    _demo = demo
    _apply_minimum()

    # 設定を切り替えたときにブラウザの再読み込みだけで下限が追従するようにする
    # （継承が OFF のまま 0 を入力できると CFG 0 で生成されてしまうため）
    shared.opts.onchange('easy_template_inherit_hr_cfg', _apply_minimum, call=False)


def _use_cfg_with_sentinel(val):
    """本体 use_cfg の差し替え。センチネル値 0 も編集可能として扱う"""
    if val is None:
        return gr.skip()

    # 継承が OFF なら 0 は文字通りの CFG 0 として扱われるため、本体と同じ判定に戻す
    if not shared.opts.easy_template_inherit_hr_cfg:
        return gr.update(interactive=val > 1.0)

    return gr.update(interactive=is_hr_negative_interactive(val))


def _patch_use_cfg():
    """create_ui の直前に modules.ui.use_cfg を差し替える

    Hires CFG Scale が 0 のとき本体は Hires negative prompt をグレーアウトするが、
    継承後は negative が効くため表示と実挙動が食い違う。`hr_cfg.change(fn=use_cfg, ...)`
    は create_ui の実行中に評価されるので、その前にモジュール属性を差し替えておく。

    同じ use_cfg は本体 CFG Scale 側（modules/ui.py:244, 642）にも使われるが、
    そちらのスライダーは下限 1.0 で 0 に到達しないため挙動は変わらない。
    """
    # 循環インポートを避けるためコールバック内で import する
    from modules import ui

    current = getattr(ui, TARGET_FN_NAME, None)
    if current is _use_cfg_with_sentinel:
        return

    if not callable(current):
        print('[Easy Template Selector] Hires negative prompt の制御関数'
              f' ({TARGET_FN_NAME}) が見つからないため差し替えを見送りました')
        return

    setattr(ui, TARGET_FN_NAME, _use_cfg_with_sentinel)


script_callbacks.on_before_ui(_patch_use_cfg)
script_callbacks.on_after_component(_capture_hr_cfg)
script_callbacks.on_app_started(_on_app_started)
