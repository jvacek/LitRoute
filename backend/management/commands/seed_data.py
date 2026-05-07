import io
import random
import string
from datetime import timedelta

from django.conf import settings
from django.contrib.gis.geos import Point
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand
from django.utils import timezone
from geopy.distance import geodesic
from PIL import Image, ImageDraw

from backend.models import CheckIn, CheckInImage, Game, Team, Unit
from flamerelay.users.models import User

DISTANCE_TEAMS = [
    ("red", "red", "#c94c35"),  # ember
    ("green", "gre", "#3f8a4a"),
    ("blue", "blu", "#3b6ea5"),
]
DISTANCE_GAME_NAME = "Seeded Distance Game"

CITIES = [
    (48.8566, 2.3522, "Paris, France"),
    (51.5074, -0.1278, "London, UK"),
    (52.5200, 13.4050, "Berlin, Germany"),
    (41.9028, 12.4964, "Rome, Italy"),
    (40.4168, -3.7038, "Madrid, Spain"),
    (55.7558, 37.6173, "Moscow, Russia"),
    (59.9343, 30.3351, "Saint Petersburg, Russia"),
    (50.0755, 14.4378, "Prague, Czech Republic"),
    (47.4979, 19.0402, "Budapest, Hungary"),
    (52.2297, 21.0122, "Warsaw, Poland"),
    (48.2082, 16.3738, "Vienna, Austria"),
    (45.4642, 9.1900, "Milan, Italy"),
    (43.7102, 7.2620, "Nice, France"),
    (53.3498, -6.2603, "Dublin, Ireland"),
    (55.6761, 12.5683, "Copenhagen, Denmark"),
    (59.9139, 10.7522, "Oslo, Norway"),
    (59.3293, 18.0686, "Stockholm, Sweden"),
    (60.1695, 24.9354, "Helsinki, Finland"),
    (40.7128, -74.0060, "New York, USA"),
    (34.0522, -118.2437, "Los Angeles, USA"),
    (41.8781, -87.6298, "Chicago, USA"),
    (29.7604, -95.3698, "Houston, USA"),
    (33.4484, -112.0740, "Phoenix, USA"),
    (47.6062, -122.3321, "Seattle, USA"),
    (45.5051, -122.6750, "Portland, USA"),
    (37.7749, -122.4194, "San Francisco, USA"),
    (49.2827, -123.1207, "Vancouver, Canada"),
    (43.6532, -79.3832, "Toronto, Canada"),
    (45.5017, -73.5673, "Montreal, Canada"),
    (19.4326, -99.1332, "Mexico City, Mexico"),
    (-23.5505, -46.6333, "São Paulo, Brazil"),
    (-34.6037, -58.3816, "Buenos Aires, Argentina"),
    (35.6762, 139.6503, "Tokyo, Japan"),
    (37.5665, 126.9780, "Seoul, South Korea"),
    (31.2304, 121.4737, "Shanghai, China"),
    (39.9042, 116.4074, "Beijing, China"),
    (1.3521, 103.8198, "Singapore"),
    (13.7563, 100.5018, "Bangkok, Thailand"),
    (28.6139, 77.2090, "New Delhi, India"),
    (19.0760, 72.8777, "Mumbai, India"),
    (-33.8688, 151.2093, "Sydney, Australia"),
    (-37.8136, 144.9631, "Melbourne, Australia"),
    (30.0444, 31.2357, "Cairo, Egypt"),
    (-26.2041, 28.0473, "Johannesburg, South Africa"),
    (6.5244, 3.3792, "Lagos, Nigeria"),
]

MESSAGES = [
    "Just arrived — what a place!",
    "Passing through on my way east.",
    "Left this with a local who promised to keep it moving.",
    "Found it at the hostel, heading north tomorrow.",
    "Long train ride, but made it.",
    "Dropped off before my flight. Hope it travels far!",
    "Incredible city. Leaving this in good hands.",
    "Road trip continues. Next stop unknown.",
    "Someone slipped this into my bag — now I'm carrying the torch.",
    "First check-in, very excited to see where it goes.",
    "Passed along to a friend heading overseas.",
    "Rainy day, warm café, good company.",
    "Markets, mountains, and this lighter.",
    "One week in, still going strong.",
    "Handoff complete. Safe travels!",
]

MAX_TRAVEL_RADIUS_KM = 4000

# (top_color, bottom_color) pairs for simple vertical gradients
_PALETTES = [
    ((135, 206, 235), (70, 130, 180)),  # sky blue
    ((255, 200, 100), (180, 80, 40)),  # sunset orange
    ((100, 180, 120), (40, 100, 60)),  # forest green
    ((200, 180, 160), (140, 110, 80)),  # desert sand
    ((180, 210, 255), (90, 130, 200)),  # dawn purple
    ((255, 220, 180), (190, 150, 110)),  # warm beach
]


_SIZES = [
    (400, 300),  # landscape 4:3
    (300, 400),  # portrait 3:4
    (300, 300),  # square
    (600, 200),  # wide banner
    (200, 600),  # tall portrait
    (480, 270),  # landscape 16:9
]


def _make_image(index: int) -> SimpleUploadedFile:
    top, bottom = _PALETTES[index % len(_PALETTES)]
    width, height = _SIZES[index % len(_SIZES)]
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / (height - 1)
        color = tuple(int(top[c] + (bottom[c] - top[c]) * t) for c in range(3))
        draw.line([(0, y), (width - 1, y)], fill=color)
    buf = io.BytesIO()
    fmt = settings.DJANGORESIZED_DEFAULT_FORCE_FORMAT
    ext = settings.DJANGORESIZED_DEFAULT_FORMAT_EXTENSIONS.get(fmt, f".{fmt.lower()}")
    img.save(buf, format=fmt, quality=settings.DJANGORESIZED_DEFAULT_QUALITY)
    return SimpleUploadedFile(f"checkin_{index}{ext}", buf.getvalue(), content_type=f"image/{fmt.lower()}")


def _nearby_cities(lat, lng):
    current = (lat, lng)
    return [c for c in CITIES if geodesic(current, (c[0], c[1])).km <= MAX_TRAVEL_RADIUS_KM]


def _random_identifier(n):
    prefix = "".join(random.choices(string.ascii_lowercase, k=3))  # noqa: S311
    return f"{prefix}-{n:02d}"


class Command(BaseCommand):
    help = "Seed the database with realistic sample units and check-ins."

    def add_arguments(self, parser):
        parser.add_argument("--units", type=int, default=1, help="Number of units to create (per team if --distance)")
        parser.add_argument("--checkins", type=int, default=7, help="Check-ins per unit")
        parser.add_argument("--email", type=str, default=None, help="Use this user as creator (by email)")
        parser.add_argument(
            "--distance",
            action="store_true",
            help="Seed a Distance game with red/green/blue teams (--units units per team).",
        )

    def _populate_unit_checkins(self, unit, user, n_checkins, now):
        current_city = random.choice(CITIES)  # noqa: S311
        # Spread check-ins across the last 30 days, oldest first
        step = timedelta(days=30) / max(n_checkins, 1)
        created = 0
        for j in range(n_checkins):
            lat, lng, place_name = current_city
            checkin = CheckIn.objects.create(
                unit=unit,
                created_by=user,
                location=Point(lng, lat),
                place=place_name,
                message=random.choice(MESSAGES),  # noqa: S311
                date_created=now - timedelta(days=30) + step * j,
            )
            n_images = random.randint(1, 3)  # noqa: S311
            for k in range(n_images):
                CheckInImage.objects.create(checkin=checkin, image=_make_image(j * 3 + k), order=k)
            created += 1
            candidates = _nearby_cities(lat, lng) or CITIES
            current_city = random.choice(candidates)  # noqa: S311
        return created

    def _delete_units(self, qs):
        """Delete units in `qs` after first removing all their check-ins, to avoid
        on_delete PROTECT/CASCADE issues from CheckIn → Unit and Unit → Game FKs."""
        CheckIn.objects.filter(unit__in=qs).delete()
        qs.delete()

    def _seed_distance_game(self, user, n_units, n_checkins, now):
        existing_games = Game.objects.filter(name=DISTANCE_GAME_NAME)
        self._delete_units(Unit.objects.filter(game__in=existing_games))
        existing_games.delete()
        game = Game.objects.create(mode=Game.Modes.DISTANCE, name=DISTANCE_GAME_NAME)
        self.stdout.write(f"Created Distance game (id={game.id}, name={game.name!r})")

        created_units = []
        created_checkins = 0
        for team_name, prefix, color in DISTANCE_TEAMS:
            team, _ = Team.objects.update_or_create(name=team_name, defaults={"color": color})
            for i in range(1, n_units + 1):
                identifier = f"{prefix}-{i:02d}"
                self._delete_units(Unit.objects.filter(identifier=identifier))
                unit = Unit.objects.create(
                    identifier=identifier,
                    created_by=user,
                    team=team,
                    game=game,
                )
                unit.subscribers.add(user)
                created_units.append(identifier)
                created_checkins += self._populate_unit_checkins(unit, user, n_checkins, now)
        return created_units, created_checkins

    def handle(self, *args, **options):
        n_units = options["units"]
        n_checkins = options["checkins"]

        if not User.objects.filter(is_superuser=True).exists():
            User.objects.create_superuser(username="admin", email="admin@test.com", password="DCBA432!")  # noqa: S106
            self.stdout.write(self.style.WARNING("Created superuser admin@test.com (password: DCBA432!)"))

        if options["email"]:
            try:
                user = User.objects.get(email=options["email"])
            except User.DoesNotExist:
                self.stderr.write(f"No user with email {options['email']!r}")
                return
        elif User.objects.filter(is_superuser=True).exists():
            user = User.objects.filter(is_superuser=True).first()
        elif User.objects.exists():
            user = User.objects.first()
        else:
            user = User.objects.create_user(email="seed@example.com")
            self.stdout.write(f"Created user {user.email}")

        now = timezone.now()
        created_units = []
        created_checkins = 0

        if options["distance"]:
            self.stdout.write(
                f"Seeding Distance game as {user} "
                f"({len(DISTANCE_TEAMS)} teams * {n_units} units * {n_checkins} check-ins each)"
            )
            created_units, created_checkins = self._seed_distance_game(user, n_units, n_checkins, now)
        else:
            self.stdout.write(f"Seeding as {user} ({n_units} units * {n_checkins} check-ins each)")
            for i in range(n_units):
                identifier = "john-93" if i == 0 else _random_identifier(i)
                self._delete_units(Unit.objects.filter(identifier=identifier))
                while identifier != "john-93" and Unit.objects.filter(identifier=identifier).exists():
                    identifier = _random_identifier(random.randint(0, 9999))  # noqa: S311

                unit = Unit.objects.create(
                    identifier=identifier,
                    created_by=user,
                    admin_only_checkin=identifier == "john-93",
                )
                unit.subscribers.add(user)
                created_units.append(identifier)
                created_checkins += self._populate_unit_checkins(unit, user, n_checkins, now)

        from django.core.cache import cache  # noqa: PLC0415

        cache.clear()
        self.stdout.write(
            self.style.SUCCESS(
                f"Created {len(created_units)} ({','.join(created_units)}) units and {created_checkins} check-ins."
            )
        )
