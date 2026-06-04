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
