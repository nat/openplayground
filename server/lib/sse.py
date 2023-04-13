# coding=utf-8
# credit to https://github.com/singingwolfboy/flask-sse
from __future__ import unicode_literals
import six
import json
import logging

from collections import OrderedDict
from flask import Blueprint, request, current_app, json, stream_with_context

logger = logging.getLogger(__name__)

__version__ = '1.0.0'

@six.python_2_unicode_compatible
class Message(object):
    """
    Data that is published as a server-sent event.
    """
    def __init__(self, data, type=None, id=None, retry=None):
        """
        Create a server-sent event.

        :param data: The event data. If it is not a string, it will be
            serialized to JSON using the Flask application's
            :class:`~flask.json.JSONEncoder`.
        :param type: An optional event type.
        :param id: An optional event ID.
        :param retry: An optional integer, to specify the reconnect time for
            disconnected clients of this stream.
        """
        self.data = data
        self.type = type
        self.id = id
        self.retry = retry

    def to_dict(self):
        """
        Serialize this object to a minimal dictionary, for storing in Redis.
        """
        # data is required, all others are optional
        d = {"data": self.data}
        if self.type:
            d["type"] = self.type
        if self.id:
            d["id"] = self.id
        if self.retry:
            d["retry"] = self.retry
        return d

    def __str__(self):
        """
        Serialize this object to a string, according to the `server-sent events
        specification <https://www.w3.org/TR/eventsource/>`_.
        """
        if isinstance(self.data, six.string_types):
            data = self.data
        else:
            data = json.dumps(self.data)
        lines = ["data:{value}".format(value=line) for line in data.splitlines()]
        if self.type:
            lines.insert(0, "event:{value}".format(value=self.type))
        if self.id:
            lines.append("id:{value}".format(value=self.id))
        if self.retry:
            lines.append("retry:{value}".format(value=self.retry))
        return "\n".join(lines) + "\n\n"

    def __repr__(self):
        kwargs = OrderedDict()
        if self.type:
            kwargs["type"] = self.type
        if self.id:
            kwargs["id"] = self.id
        if self.retry:
            kwargs["retry"] = self.retry
        kwargs_repr = "".join(
            ", {key}={value!r}".format(key=key, value=value)
            for key, value in kwargs.items()
        )
        return "{classname}({data!r}{kwargs})".format(
            classname=self.__class__.__name__,
            data=self.data,
            kwargs=kwargs_repr,
        )

    def __eq__(self, other):
        return (
            isinstance(other, self.__class__) and
            self.data == other.data and
            self.type == other.type and
            self.id == other.id and
            self.retry == other.retry
        )


class ServerSentEventsBlueprint(Blueprint):
    """
    A :class:`flask.Blueprint` subclass that knows how to publish, subscribe to,
    and stream server-sent events.
    """
    @property
    def sse_server(self):
        """
        Return the :class:`SSEServer` instance for this blueprint.
        """
        sse_manager = sse_server.SSEManager(address=("127.0.0.1", 9001), authkey=b'sse')
        sse_manager.connect()

        return sse_manager

    def publish(self, data, type=None, id=None, retry=None, channel='sse'):
        """
        Publish data as a server-sent event.

        :param data: The event data. If it is not a string, it will be
            serialized to JSON using the Flask application's
            :class:`~flask.json.JSONEncoder`.
        :param type: An optional event type.
        :param id: An optional event ID.
        :param retry: An optional integer, to specify the reconnect time for
            disconnected clients of this stream.
        :param channel: If you want to direct different events to different
            clients, you may specify a channel for this event to go to.
            Only clients listening to the same channel will receive this event.
            Defaults to "sse".
        """
        message = Message(data, type=type, id=id, retry=retry)
        msg_json = json.dumps(message.to_dict())
        logger.debug(f"PUBLISHING: {msg_json} to channel: {channel}")
        return self.sse_server.sse_publish(channel=channel, message=msg_json)

    def messages(self, channel='sse'):
        """
        A generator of :class:`~flask_sse.Message` objects from the given channel.
        """
        self.sse_server.sse_subscribe(channel)
        try:
            for pubsub_message in self.sse_server.sse_listen(channel)._getvalue():
                logger.debug(f"pubsub_message: {pubsub_message}")            
                if pubsub_message['type'] == 'message':
                    msg_dict = json.loads(pubsub_message['data'])
                    if msg_dict["type"] == "done":
                        logger.info("Done streaming SSE")
                        break

                    yield Message(**msg_dict)
        except GeneratorExit:
            logger.error("GeneratorExit")
        finally:
            logger.info(f"Unsubscribing from channel: {channel}")
            try:
                self.sse_server.sse_unsubscribe(channel)
            except ConnectionError:
                pass
        return None

    def stream(self):
        """
        A view function that streams server-sent events. Ignores any
        :mailheader:`Last-Event-ID` headers in the HTTP request.
        Use a "channel" query parameter to stream events from a different
        channel than the default channel (which is "sse").
        """

        uuid = json.loads(request.data)["uuid"] # this is sent upon connection from the frontend
        logger.info(f"Streaming SSE: {uuid}")

        @stream_with_context
        def generator():
            try:
                for message in self.messages(channel=uuid):
                    yield str(message)
            except GeneratorExit:
                self.sse_server.sse_publish("cancel_inference", message=json.dumps({"uuid": uuid}))
            finally:
                pass

        return current_app.response_class(
            generator(),
            mimetype='text/event-stream',
        )

sse = ServerSentEventsBlueprint('sse', __name__)
"""
An instance of :class:`~flask_sse.ServerSentEventsBlueprint`
that hooks up the :meth:`~flask_sse.ServerSentEventsBlueprint.stream`
method as a view function at the root of the blueprint. If you don't
want to customize this blueprint at all, you can simply import and
use this instance in your application.
"""
sse.add_url_rule(rule="", endpoint="stream", view_func=sse.stream, methods=["POST", "OPTIONS"])