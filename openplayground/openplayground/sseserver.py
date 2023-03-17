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
        q = queue.Queue(maxsize=50) # what about multiprocessing.Queue?
        self.listeners.append(q)
        return q

    # is this just a publish? appropriate channel?
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

'''
have maps of SSEQueues for each topic

'''

# class SSEManager(BaseManager):
# 	pass

# def start_sse():
#     lock = multiprocessing.Lock()
#     pubsub = {}
#     sse = SSEQueue()
	
#     def sse_listen(channel: str):
#         print("Listening to", channel)
#         if channel not in pubsub:
#             raise ValueError(f"Channel {channel} not found")
#         with lock:
#             return pubsub[channel].listen()

#     def sse_publish(channel: str, message: str):
#         print("Publishing to", channel, message)
#         with lock:
#             pubsub[channel].announce(message=message)
    
#     def sse_subscribe(channel: str):
#         print("Subscribing to", channel)
#         with lock:
#             if channel not in pubsub:
#                 pubsub[channel] = SSEQueue()
#             return pubsub[channel]

#     def sse_unsubscribe(channel: str):
#         print("Unsubscribing from", channel)
#         with lock:
#             if channel in pubsub:
#                 del pubsub[channel]
		    
#     SSEManager.register("sse_listen", sse_listen)
#     SSEManager.register("sse_publish", sse_publish)
#     SSEManager.register("sse_subscribe", sse_subscribe)
#     SSEManager.register("sse_unsubscribe", sse_unsubscribe)
    
#     manager = SSEManager(address=("127.0.0.1", 9001), authkey=b'sse')
#     server = manager.get_server()
#     server.serve_forever()

# def import_sse():
#     SSEManager.register("sse_listen")
#     SSEManager.register("sse_publish")
#     SSEManager.register("sse_subscribe")
#     SSEManager.register("sse_unsubscribe")

# if __name__ == "__main__":
#     start_sse()
# else:
# 	import_sse() 