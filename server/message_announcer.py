import queue
from utils import format_sse

# Used for SSE - pub/sub pattern
class MessageAnnouncer:

    def __init__(self):
        self.listeners = []
        self.can_send = True

    # allow client to subscribe to recieving messages
    def listen(self):
        self.can_send = True
        self.listeners.append(queue.Queue(maxsize=50))
        # send initial message for javascript eventsource to connect
        self.listeners[-1].put_nowait(format_sse(data="You have successfully connected."))
        return self.listeners[-1]

    # dispatch message to all listeners
    def announce(self, msg, uuid=None):
        for i in reversed(range(len(self.listeners))):
            try:
                self.listeners[i].put_nowait(msg)
            except queue.Full:
                print("Listener queue full, removing listener")
                del self.listeners[i]
    
    # stop listening to messages when GeneratorExit is raised
    def stop_listening(self):
        self.listeners = []
        self.can_send = False

    # for other functions to know if sending message is possible
    def send_message(self):
        return self.can_send