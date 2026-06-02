"""Optional standalone price-stream feeder.

By default the backend process owns the price stream and all bots (see
app/main.py). This module exists only if you later want to run the market-data
feed as a separate process; it does NOT run bots, to avoid double execution.
"""

import asyncio
import logging

from app.workers.price_stream import stream_symbols

logging.basicConfig(level=logging.INFO)


async def main() -> None:
    await stream_symbols(["BTC/USDT", "ETH/USDT"])


if __name__ == "__main__":
    asyncio.run(main())
