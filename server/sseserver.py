# Thread Safe and Singular Global Instance of SSE Server
import multiprocessing
from multiprocessing.managers import BaseManager
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
        q = queue.Queue(maxsize=5) # what about multiprocessing.Queue?
        self.listeners.append(q)
        return q

    # is this just a publish? appropriate channel?
    def announce(self, message: str):
        for i in reversed(range(len(self.listeners))):
            try:
                self.listeners[i].put_nowait(message)
            except queue.Full:
                del self.listeners[i]

class SSEManager(BaseManager):
	pass

def start_sse():
    lock = multiprocessing.Lock()
    pubsub = {}
    sse = SSEQueue()
	
    def sse_listen(channel: str):
        if channel not in pubsub:
            raise ValueError(f"Channel {channel} not found")
        with lock:
            return pubsub[channel].listen()

    def sse_publish(channel: str, message: str):
        with lock:
            pubsub[channel].announce(message=message)
    
    def sse_subscribe(channel: str):
        with lock:
            if channel not in pubsub:
                pubsub[channel] = SSEQueue()
            return pubsub[channel]

    def sse_unsubscribe(channel: str):
        with lock:
            if channel in pubsub:
                del pubsub[channel]
		    
    SSEManager.register("sse_listen", sse_listen)
    SSEManager.register("sse_publish", sse_publish)
    SSEManager.register("sse_subscribe", sse_subscribe)
    SSEManager.register("sse_unsubscribe", sse_unsubscribe)
    
    manager = SSEManager(address=("127.0.0.1", 2437), authkey=b'sse')
    server = manager.get_server()
    server.serve_forever()

def import_sse():
    SSEManager.register("sse_listen")
    SSEManager.register("sse_publish")
    SSEManager.register("sse_subscribe")
    SSEManager.register("sse_unsubscribe")

if __name__ == "__main__":
    start_sse()
else:
	import_sse() 