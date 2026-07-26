"""Small, bounded in-memory preview session registry."""

from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from .processor import ImageAnalysis


@dataclass(slots=True)
class ImageSession:
    id: str
    path: Path
    original_name: str
    preview: NDArray[np.generic]
    preview_jpeg: bytes
    width: int
    height: int
    source_bits: int
    color_profile: str
    color_info: dict[str, object]
    icc_profile: bytes | None
    analysis: ImageAnalysis
    is_temporary: bool
    created_at: float


class SessionStore:
    def __init__(self, limit: int = 6) -> None:
        self.limit = limit
        self._sessions: OrderedDict[str, ImageSession] = OrderedDict()
        self._lock = threading.Lock()

    def add(self, session: ImageSession) -> ImageSession:
        with self._lock:
            self._sessions[session.id] = session
            self._sessions.move_to_end(session.id)
            while len(self._sessions) > self.limit:
                _, expired = self._sessions.popitem(last=False)
                if expired.is_temporary:
                    expired.path.unlink(missing_ok=True)
        return session

    def get(self, session_id: str) -> ImageSession | None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                self._sessions.move_to_end(session_id)
            return session

    @staticmethod
    def new_id() -> str:
        return uuid.uuid4().hex
