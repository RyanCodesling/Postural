"""Put the ml/ project root on sys.path so tests import the local packages."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
