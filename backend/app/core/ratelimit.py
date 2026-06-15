"""Shared rate limiter (slowapi). Per-route limits are applied with the
``@limiter.limit(...)`` decorator on endpoints that take a ``request: Request``
parameter. Keyed by client IP."""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
