# Thread Safe and Singular Global Instance of SSE Server
import queue
import logging

logger = logging.getLogger(__name__)
class SSEQueue:
    def __init__(self):
        self.listeners = []

    def listen(self):
        logger.info("LISTENING")
        q = queue.Queue(maxsize=2000) # what about multiprocessing.Queue?
        self.listeners.append(q)
        return q

    def publish(self, message: str):
        logger.debug(f"PUBLISHING {message}")
        for i in reversed(range(len(self.listeners))):
            try:
                self.listeners[i].put_nowait(message)
            except queue.Full:
                del self.listeners[i]

class SSEQueueWithTopic:
    def __init__(self):
        self.pubsub : dict[str, SSEQueue] = {}

    def listen(self, topic: str):
        logger.info(f"LISTENING TO: {topic}")
        if topic not in self.pubsub:
            raise ValueError(f"Channel {topic} not found")
        return self.pubsub[topic].listen()

    def publish(self, topic: str, message: str):
        logger.debug(f"PUBLISHING TO: {topic} MESSAGE: {message}")
        if topic not in self.pubsub:
            raise ValueError(f"Topic {topic} not found")
        self.pubsub[topic].announce(message=message)
    
    def add_topic(self, topic: str):
        logger.info(f"SUBSCRIBING TO: {topic}")
        if topic not in self.pubsub:
            self.pubsub[topic] = SSEQueue()
        return self.pubsub[topic]

    def get_topic(self, topic: str):
        logger.info(f"GETTING TOPIC: {topic}")
        if topic not in self.pubsub:
            raise ValueError(f"Topic {topic} not found")
        return self.pubsub[topic]
    
    def remove_topic(self, topic: str):
        logger.info(f"REMOVING TOPIC: {topic}")
        if topic not in self.pubsub:
            raise ValueError(f"Topic {topic} not found")
        del self.pubsub[topic]