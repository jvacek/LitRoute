EXAMPLE_IDENTIFIER = "john-93"

CHECKIN_EDIT_GRACE_PERIOD_HOURS = 6
CHECKIN_DELETE_GRACE_PERIOD_HOURS = 6

UNIT_DISTANCE_CACHE_TTL = 60 * 60  # 1 hour

STATS_CACHE_KEY = "api:stats"
STATS_CACHE_TTL = 60 * 5  # 5 minutes

GLOBE_PINS_CACHE_KEY = "api:globe-pins"
GLOBE_PINS_CACHE_TTL = 60 * 10  # 10 minutes
GLOBE_PINS_COUNT = 20

LOGIN_CODE_TIMEOUT_SECONDS = 3 * 60  # 3 minutes

CHECKIN_EMAIL_DELAY_SECONDS = 5 * 60  # 5 minutes — wait before sending so deleted check-ins don't trigger emails
LOGIN_CODE_MAX_ATTEMPTS = 3

CHECKIN_IMAGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
CHECKIN_MAX_IMAGES = 5

EMAIL_TASK_MAX_RETRIES = 3
EMAIL_TASK_RETRY_BACKOFF_SECONDS = 60
EMAIL_TASK_RETRY_BACKOFF_MAX_SECONDS = 300

GUEST_EMAIL_VERIFICATION_EXPIRY_SECONDS = 24 * 60 * 60  # 24 hours — max_age for signing.loads

CHECKIN_ANONYMOUS_NAME_MAX_LENGTH = 100

FEEDBACK_MESSAGE_MAX_LENGTH = 5000
FEEDBACK_ADMIN_PREVIEW_LENGTH = 80

DISTANCE_DEFAULT_ALLOWED_TIME = 60 * 24  # 60 days in hours — Distance mode default
HOT_POTATO_SHELF_LIFE = 24 * 5  # hours (5 days) — Hot Potato mode default
HOT_POTATO_MIN_DISTANCE_METERS = 1000
# Floor for the drift envelope on game-mode check-ins.
GAME_GPS_DRIFT_FLOOR_METERS = 500

# Max implied speed between consecutive check-ins on the same unit, in km/h.
# You ain't going from berlin to beijin in 20 seconds honey...
CHECKIN_MAX_IMPLIED_SPEED_KMH = 1000

# Minimum gap between consecutive check-ins on a game-mode unit. Doubles as
# anti-spam and as a floor that keeps the implied-speed check well-conditioned
# (without it, a 200m pin correction five seconds later would imply ~150km/h
# and trip the speed check).
GAME_CHECKIN_MIN_GAP_SECONDS = 60

# Game-mode check-ins must populate a real place — at least this many Unicode
# letters or digits — so leaderboard rows aren't junk like "..." or "ab".
# Mirrored on the frontend.
MIN_GAME_REQUIRED_WORD_CHARS = 3

# Anon signing name only needs one letter/digit — initials, single-character
# nicknames, and CJK single-glyph names are all legitimate.
MIN_GAME_REQUIRED_NAME_CHARS = 1

GAME_LEADERBOARD_CACHE_TTL = 5 * 60  # 5 minutes
GAME_LEADERBOARD_CACHE_KEY_PREFIX = "game:leaderboard"

# Single-flight lock around expensive cache-miss compute. Without it, a
# thundering herd on cold cache runs the full NxM geodesic compute many times
# in parallel. Shared by every caller of `cached_with_lock`.
CACHE_SINGLEFLIGHT_LOCK_TTL_SECONDS = 30
CACHE_SINGLEFLIGHT_LOCK_POLL_ATTEMPTS = 10
CACHE_SINGLEFLIGHT_LOCK_POLL_SECONDS = 0.2

# Journey-map data lives in a separate endpoint with its own cache. Heavier
# payload, accessed less often than the leaderboard table, longer TTL.
GAME_JOURNEYS_CACHE_TTL = 10 * 60  # 10 minutes
GAME_JOURNEYS_CACHE_KEY_PREFIX = "game:journeys"
