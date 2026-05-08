"""Logic-layer tests for `Unit` model methods.

Request-layer counterpart for the same rules:
`backend.tests.api.test_checkins.TestCheckInCreate`.
"""

from __future__ import annotations

from flamerelay.users.tests.factories import UserFactory


class TestCanUserCheckIn:
    def test_first_checkin_allowed(self, unit):
        assert unit.can_user_check_in(UserFactory.create()) is True

    def test_current_holder_can_check_in_again(self, unit, make_checkin):
        user = UserFactory.create()
        make_checkin(unit, user)
        assert unit.can_user_check_in(user) is True

    def test_past_holder_blocked_after_handoff(self, unit, make_checkin):
        user_a = UserFactory.create()
        user_b = UserFactory.create()
        make_checkin(unit, user_a)
        make_checkin(unit, user_b)
        assert unit.can_user_check_in(user_a) is False

    def test_new_user_allowed_when_unit_has_checkins(self, unit, make_checkin):
        make_checkin(unit, UserFactory.create())
        assert unit.can_user_check_in(UserFactory.create()) is True

    def test_superuser_always_allowed(self, unit, make_checkin):
        user_a = UserFactory.create()
        user_b = UserFactory.create()
        superuser = UserFactory.create(is_superuser=True)
        # user_a was current holder, then got handed off, then re-claimed —
        # under normal rules they'd be blocked, but superuser bypass applies.
        make_checkin(unit, user_a)
        make_checkin(unit, user_b)
        make_checkin(unit, user_a)
        assert unit.can_user_check_in(superuser) is True
