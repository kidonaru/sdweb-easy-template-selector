"""Hires CFG Scale の 0 = 「CFG Scale を継承」を解決する

reForge は Hires CFG Scale の 0 を「本体の CFG Scale と同じ値を使う」センチネル値として
扱っていたが、Forge Neo（本家 Forge 由来）にはこの仕様が無く、0 がそのまま CFG 0 として
サンプラーへ渡ってしまう。reForge 時代のテンプレートや pnginfo を Neo で使えるように、
生成直前にこの継承を展開する。

WebUI に依存しないため、tests/test_hr_cfg_inherit.py から素の Python でテストできる。
"""


def resolve_hr_cfg(enable_hr, hr_cfg, cfg_scale):
    """継承後の Hires CFG Scale を返す。変更不要なら None を返す

    Args:
        enable_hr: Hires.fix が有効か
        hr_cfg: 現在の Hires CFG Scale
        cfg_scale: 本体の CFG Scale

    Returns:
        代入すべき値、または変更不要を表す None
    """
    # Hires.fix が無効なら hr_cfg は参照されない
    if not enable_hr:
        return None

    # 0 以外は明示指定（1.0 = ネガティブ無効も含む）なので尊重する
    if hr_cfg != 0:
        return None

    # 継承先が 0 では継承する意味がない
    if cfg_scale == 0:
        return None

    # infotext の表記を安定させるため float に揃える
    return float(cfg_scale)


def is_hr_negative_interactive(hr_cfg):
    """Hires negative prompt 欄を編集可能にすべきかを返す

    本体 modules/ui.py:61 の use_cfg は `hr_cfg > 1.0` で判定するが、
    センチネル値 0 は継承後に本体 CFG Scale へ展開されて negative が効くため、
    グレーアウトさせると表示と実挙動が食い違う。0 を編集可能側に加える。

    Args:
        hr_cfg: 現在の Hires CFG Scale

    Returns:
        編集可能にすべきなら True
    """
    return hr_cfg == 0 or hr_cfg > 1.0
