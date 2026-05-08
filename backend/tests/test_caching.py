"""Cache invalidation, single-flight, and signal-driven invalidation tests."""

from __future__ import annotations

import threading
from unittest.mock import patch

import pytest
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.test import TestCase

from backend.factories import GameFactory, UnitFactory
from backend.models import CheckIn
from backend.services import (
    cached_with_lock,
    game_journeys_cache_key,
    game_leaderboard_cache_key,
)
from config.constants import GLOBE_PINS_CACHE_KEY, STATS_CACHE_KEY
from flamerelay.users.services import anonymize_user
from flamerelay.users.tests.factories import UserFactory

LONDON = Point(-0.1278, 51.5074)
PARIS = Point(2.3522, 48.8566)


def _create_checkin(unit, user, location=LONDON):
    """Bypass the API entirely — simulates admin / shell / fixture writes."""
    with (
        patch("backend.models.send_email_to_subscribers_task.apply_async"),
        patch("backend.models.send_thank_you_email_task.apply_async"),
    ):
        return CheckIn.objects.create(unit=unit, created_by=user, location=location)


class TestCachedWithLock:
    def test_returns_cached_value_when_present(self, db):
        cache.set("test:cwl:hit", {"foo": 1}, 60)
        try:
            calls = []
            result = cached_with_lock("test:cwl:hit", lambda: calls.append(1) or {"foo": 2}, 60)
            assert result == {"foo": 1}
            assert calls == []
        finally:
            cache.delete("test:cwl:hit")

    def test_computes_and_caches_on_miss(self, db):
        cache.delete("test:cwl:miss")
        try:
            result = cached_with_lock("test:cwl:miss", lambda: {"computed": True}, 60)
            assert result == {"computed": True}
            assert cache.get("test:cwl:miss") == {"computed": True}
        finally:
            cache.delete("test:cwl:miss")

    def test_single_flight_under_concurrency(self, db):
        """Concurrent threads on a cold cache must coalesce to one compute."""
        cache.delete("test:cwl:concurrent")
        cache.delete("test:cwl:concurrent:lock")
        call_count = [0]
        ready = threading.Event()

        def slow_compute():
            call_count[0] += 1
            ready.wait(timeout=1.0)  # hold the lock so polling threads observe it
            return {"n": call_count[0]}

        def worker(results, idx):
            results[idx] = cached_with_lock("test:cwl:concurrent", slow_compute, 60)

        try:
            threads = []
            results = [None] * 10
            for i in range(10):
                t = threading.Thread(target=worker, args=(results, i))
                threads.append(t)
                t.start()
            # Give threads time to all hit the lock, then release the compute.
            threading.Event().wait(0.05)
            ready.set()
            for t in threads:
                t.join(timeout=5)

            # Exactly one thread ran the compute. Others polled and read the
            # cached value (or fell through after the poll budget — which is
            # 2s, longer than the compute's 0.05s wait, so all should hit
            # the cache).
            assert call_count[0] == 1
            assert all(r == {"n": 1} for r in results)
        finally:
            cache.delete("test:cwl:concurrent")
            cache.delete("test:cwl:concurrent:lock")


class TestSignalInvalidation(TestCase):
    """Direct-ORM CheckIn writes (admin / shell) must invalidate caches via
    the post_save / post_delete signals in models.py. The signal calls
    `transaction.on_commit`, so we wrap each block in
    `captureOnCommitCallbacks(execute=True)` to force the deferred
    callbacks to fire inside the test transaction."""

    def test_create_invalidates_stats_and_globe_pins(self):
        unit = UnitFactory.create()
        user = UserFactory.create()
        cache.set(STATS_CACHE_KEY, {"sentinel": True}, 60)
        cache.set(GLOBE_PINS_CACHE_KEY, [{"sentinel": True}], 60)

        with self.captureOnCommitCallbacks(execute=True):
            _create_checkin(unit, user)

        assert cache.get(STATS_CACHE_KEY) is None
        assert cache.get(GLOBE_PINS_CACHE_KEY) is None

    def test_create_invalidates_game_leaderboard(self):
        game = GameFactory.create()
        unit = UnitFactory.create(game=game)
        user = UserFactory.create()
        leaderboard_key = game_leaderboard_cache_key(game.id)
        journeys_key = game_journeys_cache_key(game.id)
        cache.set(leaderboard_key, {"sentinel": True}, 60)
        cache.set(journeys_key, {"sentinel": True}, 60)

        with self.captureOnCommitCallbacks(execute=True):
            _create_checkin(unit, user)

        assert cache.get(leaderboard_key) is None
        assert cache.get(journeys_key) is None

    def test_delete_invalidates_caches(self):
        game = GameFactory.create()
        unit = UnitFactory.create(game=game)
        user = UserFactory.create()
        with self.captureOnCommitCallbacks(execute=True):
            checkin = _create_checkin(unit, user)
        leaderboard_key = game_leaderboard_cache_key(game.id)
        cache.set(leaderboard_key, {"sentinel": True}, 60)

        with self.captureOnCommitCallbacks(execute=True):
            checkin.delete()

        assert cache.get(leaderboard_key) is None


class TestAnonymizeUserInvalidation(TestCase):
    """`anonymize_user` does a bulk `update(message="")` plus a `user.save()`
    that clears `user.name`. Both bypass the CheckIn post_save signal, so
    the function invalidates per-game caches explicitly."""

    def test_invalidates_all_affected_games(self):
        user = UserFactory.create()
        game_a = GameFactory.create()
        game_b = GameFactory.create()
        unit_a = UnitFactory.create(game=game_a)
        unit_b = UnitFactory.create(game=game_b)
        with self.captureOnCommitCallbacks(execute=True):
            _create_checkin(unit_a, user)
            _create_checkin(unit_b, user)

        leaderboard_a = game_leaderboard_cache_key(game_a.id)
        leaderboard_b = game_leaderboard_cache_key(game_b.id)
        journeys_a = game_journeys_cache_key(game_a.id)
        journeys_b = game_journeys_cache_key(game_b.id)
        cache.set(leaderboard_a, {"sentinel": True}, 60)
        cache.set(leaderboard_b, {"sentinel": True}, 60)
        cache.set(journeys_a, {"sentinel": True}, 60)
        cache.set(journeys_b, {"sentinel": True}, 60)

        with (
            self.captureOnCommitCallbacks(execute=True),
            patch("flamerelay.users.services.send_account_deletion_email_task.delay"),
        ):
            anonymize_user(user)

        assert cache.get(leaderboard_a) is None
        assert cache.get(leaderboard_b) is None
        assert cache.get(journeys_a) is None
        assert cache.get(journeys_b) is None


@pytest.fixture(autouse=True)
def _clear_cache():
    """Tests in this module manipulate shared cache keys; reset between tests."""
    yield
    cache.clear()
