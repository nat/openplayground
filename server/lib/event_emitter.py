import threading
from enum import Enum

class EVENTS(Enum):
    MODEL_ADDED = 'update_model_added'
    MODEL_REMOVED = 'update_model_removed'
    MODEL_STATUS_UPDATE = 'update_model_status'
    MODEL_UPDATED = 'update_model'
    MODEL_DOWNLOAD_UPDATE = 'update_model_download'
    PROVIDER_API_KEY_UPDATE = 'update_provider_api_key'
    SAVED_TO_DISK = 'saved_to_disk'

class Singleton(type):
    _instances = {}
    _lock = threading.Lock()

    def __call__(cls, *args, **kwargs):
        with cls._lock:
            if cls not in cls._instances:
                cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class EventEmitter(metaclass=Singleton):
    def __init__(self):
        self.listeners = {}
        self._lock = threading.Lock()

    def on(self, event: EVENTS, listener):
        event = event.value
        with self._lock:
            if event not in self.listeners:
                self.listeners[event] = []
            self.listeners[event].append(listener)

    def off(self, event, listener):
        with self._lock:
            if event in self.listeners and listener in self.listeners[event]:
                self.listeners[event].remove(listener)

    def emit(self, event: EVENTS, *args, **kwargs):
        if event not in EVENTS.__members__.values():
            raise ValueError(f"Invalid event type: {event}")
        if event.value not in self.listeners:
            return

        with self._lock:
            listeners_to_notify = self.listeners[event.value].copy()

        for listener in listeners_to_notify:
            listener(event, *args, **kwargs)
