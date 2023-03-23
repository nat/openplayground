# Thread Safe and Singular Global Instance of SSE Server
import queue

# what if we just kept a SSEQueue for each topic
# SSEManager can then deal with routing subscriptions and publishing using Queue as the data struc?
# you subscribe to a topic, you get it's corresponding SSEQueue and you can listen for updates on that topic
# keeps SSEQueue as a clean data struc, but allows for multiple topics
# listen returns the queue that the client will be listening to - waiting for updates to that queue
# so we can just create queue for each topic, and clients will receive the same exact queue for the same topic
# hence they will listen to the exact same messages that come to it
# how does unsubscribe work?
class SSEQueue:
    def __init__(self):
        self.listeners = []

    def listen(self):
        q = queue.Queue(maxsize=50) # what about multiprocessing.Queue?
        self.listeners.append(q)
        return q

    def announce(self, message: str):
        print("annnouncing from queue", message, self.listeners)
        for i in reversed(range(len(self.listeners))):
            try:
                self.listeners[i].put_nowait(message)
            except queue.Full:
                del self.listeners[i]

class SSEQueueWithTopic:
    def __init__(self):
        self.pubsub : dict[str, SSEQueue] = {}

    def sse_listen(self, channel: str):
        print("LISTENING TO:", channel)
        if channel not in self.pubsub:
            raise ValueError(f"Channel {channel} not found")
        print(self.pubsub)
        return self.pubsub[channel].listen()

    def sse_publish(self, channel: str, message: str):
        print("PUBLISHING TO:", channel, message)
        if channel not in self.pubsub:
            raise ValueError(f"Channel {channel} not found")
        self.pubsub[channel].announce(message=message)
    
    def sse_subscribe(self, channel: str):
        print("SUBSCRIBING TO:", channel)
        if channel not in self.pubsub:
            self.pubsub[channel] = SSEQueue()
        print(self.pubsub)
        return self.pubsub[channel]

    def sse_unsubscribe(self, channel: str):
        print("UNSUBSCRIBING FROM:", channel)
        if channel in self.pubsub:
            del self.pubsub[channel]