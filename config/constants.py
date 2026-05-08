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

# Game mode specifics
LOCATION_CLAIM_TTL_SECONDS = 2 * 60  # 2 minutes
LOCATION_CLAIM_MAX_DRIFT_METERS = 500
# >100m accuracy generally indicates coarse network positioning rather than real GPS
LOCATION_CLAIM_MAX_ACCURACY_METERS = 100

DISTANCE_DEFAULT_ALLOWED_TIME = 60 * 24  # 60 days in hours — Distance mode default
HOT_POTATO_SHELF_LIFE = 24 * 5  # hours (5 days) — Hot Potato mode default
HOT_POTATO_MIN_DISTANCE_METERS = 1000

# Game-mode check-ins must populate a real place and (for anon users) a real
# signing name — at least this many Unicode letters or digits — so leaderboard
# rows aren't junk like "..." or "ab". Mirrored on the frontend.
MIN_GAME_REQUIRED_WORD_CHARS = 3

GAME_LEADERBOARD_CACHE_TTL = 5 * 60  # 5 minutes
GAME_LEADERBOARD_CACHE_KEY_PREFIX = "game:leaderboard"

# Single-flight lock around expensive cache-miss compute. Without it, a
# thundering herd on cold cache runs the full NxM geodesic compute many times
# in parallel.
GAME_LEADERBOARD_LOCK_TTL_SECONDS = 30
GAME_LEADERBOARD_LOCK_POLL_ATTEMPTS = 10
GAME_LEADERBOARD_LOCK_POLL_SECONDS = 0.2

# Journey-map data lives in a separate endpoint with its own cache. Heavier
# payload, accessed less often than the leaderboard table, longer TTL.
GAME_JOURNEYS_CACHE_TTL = 10 * 60  # 10 minutes
GAME_JOURNEYS_CACHE_KEY_PREFIX = "game:journeys"
