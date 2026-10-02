import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

GARMIN_EMAIL = os.getenv("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.getenv("GARMIN_PASSWORD", "")
GARMIN_DOMAIN = os.getenv("GARMIN_DOMAIN", "garmin.com")

GARMIN_TOKEN_DIR = Path.home() / ".garminconnect"
GARMIN_TOKEN_DIR.mkdir(exist_ok=True)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "db.json"
