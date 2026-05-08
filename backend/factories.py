import factory
from django.contrib.gis.geos import Point
from django.utils import timezone
from factory import fuzzy

from flamerelay.users.tests.factories import UserFactory

from .models import CheckIn, Game, Unit


class GameFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Game

    name = factory.Sequence(lambda n: f"Test Game {n}")
    mode = Game.Modes.RELAY


class UnitFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Unit

    # string, a dash, and two digits
    identifier = factory.Sequence(
        lambda n: f"{fuzzy.FuzzyText(length=3).fuzz().lower()}-{n}{fuzzy.FuzzyInteger(0, 9).fuzz()}"
    )
    created_by = factory.SubFactory(UserFactory)
    date_created = factory.Faker("date_time_this_month", tzinfo=timezone.get_current_timezone())


class CheckInFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = CheckIn

    unit = factory.SubFactory(UnitFactory)
    date_created = factory.Faker("date_time_this_month", tzinfo=timezone.get_current_timezone())
    created_by = factory.SubFactory(UserFactory)
    message = factory.Faker("text")
    location = factory.LazyFunction(lambda: Point(fuzzy.FuzzyFloat(-180, 180).fuzz(), fuzzy.FuzzyFloat(-90, 90).fuzz()))
