from datetime import date
from typing import Any

from pydantic import BaseModel


class BacktestIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class BacktestMetrics(BaseModel):
    sharpe: float = 0.0
    sortino: float = 0.0
    calmar: float = 0.0
    profit_factor: float = 0.0
    expectancy_pct: float = 0.0
    exposure_pct: float = 0.0
    ann_return_pct: float = 0.0


class MonteCarlo(BaseModel):
    simulations: int
    median_return_pct: float
    p5_return_pct: float
    p95_return_pct: float
    prob_profit_pct: float
    median_maxdd_pct: float
    p95_maxdd_pct: float


class BacktestOut(BaseModel):
    total_return_pct: float
    max_drawdown_pct: float
    win_rate: float
    trades: list[dict[str, Any]]
    equity_curve: list[dict[str, float]]
    price_series: list[dict[str, float]] = []  # OHLC per candle: {x,o,h,l,c}
    candles: int = 0
    start: float | None = None  # unix seconds of the first candle tested
    end: float | None = None    # unix seconds of the last candle tested
    metrics: BacktestMetrics | None = None
    monte_carlo: MonteCarlo | None = None


class SensitivityIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class SensitivityOut(BaseModel):
    x_label: str
    y_label: str
    x_values: list[float]
    y_values: list[float]
    grid: list[list[float]]   # rows by y, cols by x — total_return_pct per cell
    cur_x: float
    cur_y: float
    verdict: str              # "robust" | "mixed" | "fragile"
    message: str


class OptimizeIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class OptimizeResult(BaseModel):
    config: dict[str, Any]
    total_return_pct: float
    max_drawdown_pct: float
    win_rate: float
    trades: int
    score: float


class OptimizeOut(BaseModel):
    results: list[OptimizeResult]
    tested: int
    candles: int


class DataCoverage(BaseModel):
    symbol: str
    timeframe: str
    count: int
    first: float | None = None  # unix seconds of the earliest cached candle
    last: float | None = None    # unix seconds of the latest cached candle


class WalkForwardIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class WalkForwardFold(BaseModel):
    n: int
    in_return_pct: float       # best result on the training window (optimistic)
    out_return_pct: float      # that config on the next, unseen window (honest)
    out_drawdown_pct: float
    out_trades: int
    summary: str               # short label of the config the optimizer picked
    config: dict[str, Any] | None = None  # the winning config (saveable)


class WalkForwardOut(BaseModel):
    verdict: str               # "robust" | "overfit" | "mixed" | "insufficient"
    message: str
    folds: list[WalkForwardFold] = []
    avg_in_return_pct: float = 0.0
    avg_out_return_pct: float = 0.0
    combined_out_return_pct: float = 0.0  # compounded out-of-sample (realistic) result
    profitable_folds: int = 0
    total_folds: int = 0
    candles: int = 0


class AnalyzeIn(BaseModel):
    strategy_id: int
    start_date: date | None = None
    end_date: date | None = None


class AttemptInfo(BaseModel):
    n: int
    total_return_pct: float
    max_drawdown_pct: float
    win_rate: float
    trades: int
    proposed_changes: str = ""
    config: dict[str, Any] | None = None


class AnalyzeOut(BaseModel):
    verdict: str
    rating: str
    assessment: str
    proposed_changes: str
    proposed_config: dict[str, Any] | None = None
    improved: bool = False
    attempts: list[AttemptInfo] = []
    best_n: int | None = None
    original_return_pct: float = 0.0
    original_drawdown_pct: float = 0.0
    best_return_pct: float | None = None
    best_drawdown_pct: float | None = None


class AnalyzeStartOut(BaseModel):
    job_id: str


class AnalyzeStatusOut(BaseModel):
    status: str  # "running" | "done" | "error"
    attempt: int = 1
    result: AnalyzeOut | None = None
    error: str | None = None


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class AskIn(BaseModel):
    strategy_id: int
    messages: list[ChatMessage]
    base_config: dict[str, Any] | None = None  # working config to refine (defaults to the saved strategy)
    start_date: date | None = None
    end_date: date | None = None


class AskOut(BaseModel):
    answer: str
    proposed_changes: str = ""
    proposed_config: dict[str, Any] | None = None
    original_return_pct: float = 0.0
    original_drawdown_pct: float = 0.0
    proposed_return_pct: float | None = None
    proposed_drawdown_pct: float | None = None
    proposed_win_rate: float | None = None
    proposed_trades: int | None = None


class GenerateIn(BaseModel):
    messages: list[ChatMessage]


class GeneratedBot(BaseModel):
    name: str
    approach: str
    config: dict[str, Any]
    total_return_pct: float = 0.0
    max_drawdown_pct: float = 0.0
    win_rate: float = 0.0
    trades: int = 0


class GenerateResult(BaseModel):
    answer: str
    symbol: str = ""
    timeframe: str = ""
    bots: list[GeneratedBot] = []


class GenerateStatusOut(BaseModel):
    status: str  # "running" | "done" | "error"
    result: GenerateResult | None = None
    error: str | None = None
