"""
Data Loader and Scenario Manager for ReverseResilia.
Loads bundled city network datasets, provides scenario switching, and caching.
"""

import os
import json
from typing import Dict, List, Optional
from ..models.schemas import NetworkData


class DataLoader:
    def __init__(self, data_dir: Optional[str] = None):
        if data_dir is None:
            # Default to repo root / data / cities
            base_dir = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "cities")
            )
            self.data_dir = base_dir
        else:
            self.data_dir = data_dir

        self._cache: Dict[str, NetworkData] = {}

    def get_supported_cities(self) -> List[Dict[str, str]]:
        return [
            {"id": "bengaluru", "name": "Bengaluru", "region": "Southern Zone"},
            {"id": "mumbai", "name": "Mumbai", "region": "Western Zone"},
            {"id": "delhi", "name": "Delhi NCR", "region": "Northern Zone"},
            {"id": "chennai", "name": "Chennai", "region": "Southern Zone"},
            {"id": "guwahati", "name": "Guwahati", "region": "North-Eastern Zone"},
        ]

    def load_city_network(self, city_id: str, force_reload: bool = False) -> NetworkData:
        city_id = city_id.lower().strip()
        if not force_reload and city_id in self._cache:
            return self._cache[city_id]

        file_path = os.path.join(self.data_dir, f"{city_id}.json")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Dataset for city '{city_id}' not found at {file_path}")

        with open(file_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        network = NetworkData.model_validate(raw_data)
        self._cache[city_id] = network
        return network

    def reload_all(self):
        self._cache.clear()
        for city in self.get_supported_cities():
            try:
                self.load_city_network(city["id"], force_reload=True)
            except Exception as e:
                print(f"Error loading {city['id']}: {e}")


default_loader = DataLoader()
