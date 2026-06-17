import numpy as np
import pandas as pd


def sma(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return float(pd.Series(values).rolling(period).mean().iloc[-1])


def ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return float(pd.Series(values).ewm(span=period, adjust=False).mean().iloc[-1])


def rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None
    series = pd.Series(values, dtype=float)
    delta = series.diff()
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = pd.Series(gain).rolling(period).mean()
    avg_loss = pd.Series(loss).rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - (100 / (1 + rs))
    last = out.iloc[-1]
    return float(last) if pd.notna(last) else None


def macd(values: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[float, float] | None:
    """Return (macd_line, signal_line) at the latest bar, or None if too short."""
    if len(values) < slow + signal:
        return None
    series = pd.Series(values, dtype=float)
    macd_line = series.ewm(span=fast, adjust=False).mean() - series.ewm(span=slow, adjust=False).mean()
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return float(macd_line.iloc[-1]), float(signal_line.iloc[-1])


def _true_range(highs: list[float], lows: list[float], closes: list[float]) -> "pd.Series":
    h = pd.Series(highs, dtype=float)
    low = pd.Series(lows, dtype=float)
    prev_close = pd.Series(closes, dtype=float).shift()
    return pd.concat([h - low, (h - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)


def atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float | None:
    """Average True Range (Wilder) at the latest bar, in price units. None if too short."""
    if len(closes) <= period:
        return None
    tr = _true_range(highs, lows, closes)
    value = tr.ewm(alpha=1 / period, adjust=False).mean().iloc[-1]
    return float(value) if pd.notna(value) else None


def adx(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> float | None:
    """Average Directional Index (Wilder) — trend strength, 0-100. None if too short."""
    if len(closes) <= 2 * period:
        return None
    h = pd.Series(highs, dtype=float)
    low = pd.Series(lows, dtype=float)
    up = h.diff()
    down = -low.diff()
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = _true_range(highs, lows, closes)
    atr_s = tr.ewm(alpha=1 / period, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm).ewm(alpha=1 / period, adjust=False).mean() / atr_s.replace(0, np.nan)
    minus_di = 100 * pd.Series(minus_dm).ewm(alpha=1 / period, adjust=False).mean() / atr_s.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    value = dx.ewm(alpha=1 / period, adjust=False).mean().iloc[-1]
    return float(value) if pd.notna(value) else None


# ---- whole-series variants -------------------------------------------------
# For a backtest the same indicator is needed at every bar. Computing it once
# over the full series (then indexing per bar) is O(n) instead of recomputing a
# growing slice every bar (O(n²)). Each returns a numpy array aligned to the
# input, with NaN during warmup — matching where the scalar version returns None
# (so backtest results are identical to the per-bar path).


def _mask(arr: "np.ndarray", n: int) -> "np.ndarray":
    arr = np.array(arr, dtype=float)  # ensure a writable copy (ewm().to_numpy() can be read-only)
    if n > 0:
        arr[:n] = np.nan
    return arr


def sma_series(values: list[float], period: int) -> "np.ndarray":
    return pd.Series(values, dtype=float).rolling(period).mean().to_numpy()


def ema_series(values: list[float], period: int) -> "np.ndarray":
    arr = pd.Series(values, dtype=float).ewm(span=period, adjust=False).mean().to_numpy()
    return _mask(arr, period - 1)


def rsi_series(values: list[float], period: int = 14) -> "np.ndarray":
    series = pd.Series(values, dtype=float)
    delta = series.diff()
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = pd.Series(gain).rolling(period).mean()
    avg_loss = pd.Series(loss).rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = (100 - (100 / (1 + rs))).to_numpy()
    return _mask(out, period)


def macd_series(values: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> tuple["np.ndarray", "np.ndarray"]:
    series = pd.Series(values, dtype=float)
    macd_line = series.ewm(span=fast, adjust=False).mean() - series.ewm(span=slow, adjust=False).mean()
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    n = slow + signal - 1
    return _mask(macd_line.to_numpy(), n), _mask(signal_line.to_numpy(), n)


def atr_series(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> "np.ndarray":
    tr = _true_range(highs, lows, closes)
    arr = tr.ewm(alpha=1 / period, adjust=False).mean().to_numpy()
    return _mask(arr, period)


def adx_series(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> "np.ndarray":
    h = pd.Series(highs, dtype=float)
    low = pd.Series(lows, dtype=float)
    up = h.diff()
    down = -low.diff()
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = _true_range(highs, lows, closes)
    atr_s = tr.ewm(alpha=1 / period, adjust=False).mean()
    plus_di = 100 * pd.Series(plus_dm).ewm(alpha=1 / period, adjust=False).mean() / atr_s.replace(0, np.nan)
    minus_di = 100 * pd.Series(minus_dm).ewm(alpha=1 / period, adjust=False).mean() / atr_s.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return _mask(dx.ewm(alpha=1 / period, adjust=False).mean().to_numpy(), 2 * period)
