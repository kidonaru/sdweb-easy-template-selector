"""scripts/upscaler_aliases.py の単体テスト

対象モジュールは WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_upscaler_aliases.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.upscaler_aliases import to_display, to_storage

# Forge Neo のドロップダウンに並ぶ名前（ファイル名 stem がそのまま表示名になる）
NEO_NAMES = ['Latent', 'RealESRGAN_x4plus_anime_6B', '4x_foolhardy_Remacri']
# reForge のドロップダウンに並ぶ名前（組み込みモデルだけ固有の表示名を持つ）
REFORGE_NAMES = ['Latent', 'R-ESRGAN 4x+ Anime6B', '4x_foolhardy_Remacri']


def test_to_storage_rewrites_alias_to_stem():
    text = 'Steps: 20, Hires upscaler: R-ESRGAN 4x+ Anime6B, Denoising strength: 0.5'
    expected = 'Steps: 20, Hires upscaler: RealESRGAN_x4plus_anime_6B, Denoising strength: 0.5'
    assert to_storage(text) == expected


def test_to_storage_keeps_user_model():
    text = 'Hires upscaler: 4x_foolhardy_Remacri, Steps: 20'
    assert to_storage(text) == text


def test_to_storage_preserves_crlf_at_line_end():
    # 値が行末（末尾カンマ無し）に来ても CRLF を LF へ壊さない
    text = 'Steps: 20\r\nHires upscaler: R-ESRGAN 4x+ Anime6B\r\n'
    expected = 'Steps: 20\r\nHires upscaler: RealESRGAN_x4plus_anime_6B\r\n'
    assert to_storage(text) == expected


def test_to_storage_touches_only_the_value():
    text = (
        'a girl, masterpiece\r\n'
        'Negative prompt: worst quality\r\n'
        'Steps: 20, Hires upscaler: R-ESRGAN 4x+ Anime6B, Model: foo\r\n'
    )
    expected = (
        'a girl, masterpiece\r\n'
        'Negative prompt: worst quality\r\n'
        'Steps: 20, Hires upscaler: RealESRGAN_x4plus_anime_6B, Model: foo\r\n'
    )
    assert to_storage(text) == expected


def test_to_display_resolves_stem_to_reforge_name():
    text = 'Hires upscaler: RealESRGAN_x4plus_anime_6B, Steps: 20'
    converted, unresolved = to_display(text, REFORGE_NAMES)
    assert converted == 'Hires upscaler: R-ESRGAN 4x+ Anime6B, Steps: 20'
    assert unresolved == []


def test_to_display_is_identity_on_neo():
    text = 'Hires upscaler: RealESRGAN_x4plus_anime_6B, Steps: 20'
    converted, unresolved = to_display(text, NEO_NAMES)
    assert converted == text
    assert unresolved == []


def test_to_display_resolves_alias_to_stem_on_neo():
    text = 'Hires upscaler: R-ESRGAN 4x+ Anime6B, Steps: 20'
    converted, unresolved = to_display(text, NEO_NAMES)
    assert converted == 'Hires upscaler: RealESRGAN_x4plus_anime_6B, Steps: 20'
    assert unresolved == []


def test_to_display_reports_unresolved_value():
    text = 'Hires upscaler: 4x_NMKD_Superscale, Steps: 20'
    converted, unresolved = to_display(text, NEO_NAMES)
    assert converted == text
    assert unresolved == ['4x_NMKD_Superscale']


def test_to_display_passes_through_when_names_unavailable():
    text = 'Hires upscaler: R-ESRGAN 4x+ Anime6B, Steps: 20'
    converted, unresolved = to_display(text, [])
    assert converted == text
    assert unresolved == []


if __name__ == '__main__':
    failures = 0
    for name, func in sorted(globals().items()):
        if not name.startswith('test_') or not callable(func):
            continue
        try:
            func()
            print(f'PASS {name}')
        except AssertionError as error:
            failures += 1
            print(f'FAIL {name}: {error}')
    print(f'\n{failures} failed')
    sys.exit(1 if failures else 0)
