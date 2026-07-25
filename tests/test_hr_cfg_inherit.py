"""scripts/hr_cfg_inherit.py の単体テスト

対象モジュールは WebUI に依存しないため、リポジトリルートから素の Python で実行できる。

    python tests/test_hr_cfg_inherit.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.hr_cfg_inherit import resolve_hr_cfg


def test_zero_inherits_cfg_scale():
    # reForge の 0 = 「CFG Scale と同じ値」を展開する
    assert resolve_hr_cfg(True, 0.0, 5.5) == 5.5


def test_result_is_always_float():
    # infotext の表記を安定させるため int 入力でも float を返す
    resolved = resolve_hr_cfg(True, 0, 6)
    assert resolved == 6.0
    assert isinstance(resolved, float)


def test_cfg_scale_one_is_inherited_as_is():
    # 継承結果が 1.0 になると Neo 側で Hires のネガティブが無効になる（processing.py:1604）。
    # reForge も同じ値を代入するため、ここで特別扱いはしない
    assert resolve_hr_cfg(True, 0.0, 1.0) == 1.0


def test_fraction_below_one_is_left_untouched():
    # reForge は step 0.1 / 下限 0 のため 0.5 等が存在しうる。0 以外は明示指定として素通しする
    assert resolve_hr_cfg(True, 0.5, 5.0) is None


def test_nonzero_is_left_untouched():
    # 明示指定された値には手を出さない
    assert resolve_hr_cfg(True, 7.0, 5.0) is None


def test_one_is_left_untouched():
    # 1.0 は Forge Neo で「ネガティブ無効」を意味する正規の値
    assert resolve_hr_cfg(True, 1.0, 5.0) is None


def test_hires_disabled_is_left_untouched():
    # Hires.fix が無効なら hr_cfg は使われないので触らない
    assert resolve_hr_cfg(False, 0.0, 5.0) is None


def test_zero_cfg_scale_is_left_untouched():
    # 継承先が 0 では意味がないので変更しない（reForge の uncond スキップ相当は Neo に無い）
    assert resolve_hr_cfg(True, 0.0, 0.0) is None


def test_negative_hr_cfg_is_left_untouched():
    # 負値は reForge 固有の uncond スキップ指定。Neo では扱えないため素通しする
    assert resolve_hr_cfg(True, -1.0, 5.0) is None


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
