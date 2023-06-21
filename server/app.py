import click
import logging
import os
import warnings
import io
import queue
import sys
from pathlib import Path
import json
import threading
import time
import re

from contextlib import contextmanager

from server.lib.entities import Model, Provider
from server.lib.inference import ProviderDetails, InferenceManager, InferenceRequest
from server.lib.event_emitter import EventEmitter, EVENTS
from server.lib.storage import Storage
from server.lib.sseserver import SSEQueueWithTopic
from server.lib.api import api_bp

from flask import Flask, g, send_from_directory
from flask_cors import CORS

from transformers import AutoTokenizer, AutoModel
from huggingface_hub import hf_hub_download, try_to_load_from_cache, scan_cache_dir, _CACHED_NO_EXIST

# Monkey patching for warnings, for convenience


def warning_on_one_line(message, category, filename, lineno, file=None, line=None):
    return '%s:%s: %s: %s\n' % (filename, lineno, category.__name__, message)


warnings.formatwarning = warning_on_one_line

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

app = Flask(__name__)


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path == "" or not os.path.exists(f'{app.static_folder}/{path}'):
        path = 'index.html'

    return send_from_directory(app.static_folder, path)


@app.errorhandler(404)
def page_not_found(i):
    path = 'index.html'
    return send_from_directory(app.static_folder, path)


@app.before_request
def before_request():
    g.global_state = app.config['GLOBAL_STATE']
    g.storage = g.global_state.get_storage()


app.register_blueprint(api_bp)

CORS(app)


class RedirectStderr:
    def __init__(self, new_stderr):
        self.new_stderr = new_stderr
        self.old_stderr = None

    def __enter__(self):
        self.old_stderr = sys.stderr
        sys.stderr = self.new_stderr

    def __exit__(self, exc_type, exc_val, exc_tb):
        sys.stderr = self.old_stderr


@contextmanager
def redirect_stderr(new_stderr):
    with RedirectStderr(new_stderr):
        yield


class MonitorThread(threading.Thread):
    def __init__(self, model, output_buffer):
        super().__init__()
        self.model = model
        self.output_buffer = output_buffer
        self._stop_event = threading.Event()
        self.event_emitter = EventEmitter()

    def run(self):
        with redirect_stderr(self.output_buffer):
            # Code that may generate errors goes here
            output_buffer = self.output_buffer
            current_shard = 0
            total_shards = 0
            last_line = 0

            while not self._stop_event.is_set():
                try:
                    lines = output_buffer.getvalue().splitlines()[last_line:]
                    last_line += len(lines)

                    for line in lines:
                        if line == "":
                            continue

                        if line.startswith("Downloading shards:"):
                            if progress := re.search(r"\| (\d+)/(\d+) \[", line):
                                current_shard, total_shards = int(
                                    progress[1]), int(progress[2])
                        elif line.startswith("Downloading"):
                            logger.info(line)
                            percentage = re.search(r":\s+(\d+)%", line)
                            percentage = percentage[0][2:] if percentage else ""

                            progress = re.search(r"\[(.*?)\]", line)
                            if progress and "?" not in progress[0]:
                                current_duration, rest = progress[0][1:-1].split(
                                    "<")
                                total_duration, speed = rest.split(",")

                                if download_size := re.search(r"\| (.*?)\[", line):
                                    current_size, total_size = download_size[0][2:-1].strip().split(
                                        "/")

                                self.event_emitter.emit(EVENTS.MODEL_DOWNLOAD_UPDATE, self.model, {
                                    'current_shard': current_shard,
                                    'total_shards': total_shards,
                                    'percentage': percentage.strip(),
                                    'current_duration': current_duration,
                                    'total_duration': total_duration,
                                    'speed': speed.strip(),
                                    'current_size': current_size,
                                    'total_size': total_size,
                                })
                except Exception as e:
                    logger.info(f"""[ERROR] {str(e)}""")
                time.sleep(0.5)

    def stop(self):
        self._stop_event.set()


class NotificationManager:
    def __init__(self, sse_queue: SSEQueueWithTopic):
        self.event_emitter = EventEmitter()
        self.event_emitter.on(EVENTS.MODEL_UPDATED,
                              self.__model_updated_callback__)
        self.event_emitter.on(EVENTS.MODEL_ADDED,
                              self.__model_added_callback__)
        # TODO Fix the bug where SSE gets blocked
        # self.event_emitter.on(EVENTS.MODEL_DOWNLOAD_UPDATE, self.__model_download_update_callback__)
        self.sse_queue = sse_queue

    def __model_added_callback__(self, model_name, model):
        if model.status == 'ready':
            self.sse_queue.publish(json.dumps({
                'type': 'notification',
                'data': {
                    'message': {
                        'event': 'modelAdded',
                        'data': {
                            'model': model.name,
                            'provider': model.provider
                        }
                    }
                }
            }))

    def __model_updated_callback__(self, model_name, model):
        if model.status == 'ready':
            self.sse_queue.publish(json.dumps({
                'type': 'notification',
                'data': {
                    'message': {
                        'event': 'modelAdded' if model.enabled == True else 'modelRemoved',
                        'data': {
                            'model': model.name,
                            'provider': model.provider
                        }
                    }
                }
            }))

    def __model_download_update_callback__(self, _, model, progress):
        self.sse_queue.publish(json.dumps({
            'type': 'notification',
            'data': {
                'message': {
                    'event': 'modelDownloadProgress',
                    'data': {
                        'model': model.name,
                        'provider': model.provider,
                        'progress': progress
                    }
                }
            }
        }))

# Perhaps this should be a singleton or each provider should have its own instance
# For now this will only deal with HuggingFace


class DownloadManager:
    def __init__(self, storage: Storage):
        logger.info("Initializing download manager...")

        self.event_emitter = EventEmitter()
        self.event_emitter.on(EVENTS.MODEL_ADDED,
                              self.__model_added_callback__)
        self.storage = storage
        self.model_queue = queue.Queue()
        self.__initialization_check__()

    def __initialization_check__(self):
        models = self.storage.get_models()

        for model in models:
            if model.status == 'pending':
                self.model_queue.put(model)

        # TODO: In the future it might make sense to have local provider specific instances
        cache_info = scan_cache_dir()
        hugging_face_local = self.storage.get_provider("huggingface-local")

        for repo_info in cache_info.repos:
            repo_id = repo_info.repo_id
            repo_type = repo_info.repo_type
            if repo_type == "model":
                if hugging_face_local.has_model(repo_id):
                    continue
                else:
                    model = Model(
                        name=repo_id,
                        capabilities=hugging_face_local.default_capabilities,
                        provider="huggingface-local",
                        status="ready",
                        enabled=False,
                        parameters=hugging_face_local.default_parameters
                    )
                    hugging_face_local.add_model(model)

        t = threading.Thread(target=self.__download_loop__)
        t.start()

        logger.info("Download loop started...")

    def __model_added_callback__(self, model_name, model):
        if model.status == 'pending':
            self.model_queue.put(model)

    def __download_loop__(self):
        while True:
            try:
                output_buffer = io.StringIO()
                with redirect_stderr(output_buffer):
                    model = self.model_queue.get(block=False)

                    monitor_thread = MonitorThread(model, output_buffer)
                    monitor_thread.start()

                    logger.info(
                        "Inside loop, about to download model", model.name)

                    _ = AutoTokenizer.from_pretrained(model.name)
                    _ = AutoModel.from_pretrained(model.name)

                    model.status = 'ready'

                    self.storage.update_model(model.name, model)

                    monitor_thread.stop()
                    monitor_thread.join()

                    logger.info("Finished downloading model", model.name)
            except queue.Empty:
                time.sleep(1)
            except Exception as e:
                logger.error("error", e)
                logger.error(
                    f"Failed to download {model.name} from {model.provider}")
            finally:
                time.sleep(1)


class GlobalStateManager:
    def __init__(self, storage):
        self.sse_manager = SSEQueueWithTopic()
        self.sse_manager.add_topic("inferences")
        self.sse_manager.add_topic("notifications")

        self.notification_manager = NotificationManager(
            self.sse_manager.get_topic("notifications"))

        self.inference_manager = InferenceManager(
            self.sse_manager.get_topic("inferences")
        )
        self.storage = storage
        self.download_manager = DownloadManager(storage)

    def get_storage(self):
        return self.storage

    def get_sse_manager(self):
        return self.sse_manager

    def text_generation(self, inference_request: InferenceRequest):
        provider = self.storage.get_provider(inference_request.model_provider)

        provider_details = ProviderDetails(
            api_key=provider.api_key,
            version_key=None
        )
        logger.info(
            f"Received inference request {inference_request.model_provider}")

        if inference_request.model_provider == "openai":
            return self.inference_manager.openai_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "cohere":
            return self.inference_manager.cohere_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "huggingface":
            return self.inference_manager.huggingface_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "forefront":
            return self.inference_manager.forefront_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "huggingface-local":
            return self.inference_manager.local_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "anthropic":
            return self.inference_manager.anthropic_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "aleph-alpha":
            return self.inference_manager.aleph_alpha_text_generation(provider_details, inference_request)
        elif inference_request.model_provider == "truefoundry":
            return self.inference_manager.truefoundry_text_generation(provider_details, inference_request)
        else:
            raise Exception(
                f"Unknown model provider, {inference_request.model_provider}. Please add a generation function in InferenceManager or route in ModelManager.text_generation"
            )

    def get_announcer(self):
        return self.inference_manager.get_announcer()


@click.group()
def cli():
    pass


@click.command()
@click.help_option('-h', '--help')
@click.option('--host',  '-H', default='localhost', help='The host to bind to. Default: localhost.')
@click.option('--port', '-p', default=5432, help='The port to bind to. Default: 5432.')
@click.option('--debug/--no-debug', default=False, help='Enable or disable Flask debug mode. Default: False.')
@click.option('--env', '-e', default=".env", help='Path to the environment file for storing and reading API keys. Default: .env.')
@click.option('--models', '-m', default=None, help='Path to the configuration file for loading models. Default: None.')
@click.option('--log-level', '-l', default='INFO', help='Set the logging level. Default: INFO.', type=click.Choice(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']))
def run(host, port, debug, env, models, log_level):
    """
    Run the OpenPlayground server.

    This command starts the OpenPlayground server with the specified options.

    Arguments:
    --host, -H: The host to bind to. Default: localhost.
    --port, -p: The port to bind to. Default: 5432.
    --debug/--no-debug: Enable or disable Flask debug mode. Default: False.
    --env, -e: Path to the environment file for storing and reading API keys. Default: .env.
    --models, -m: Path to the configuration file for loading models. Default: None.
    --log-level, -l: Set the logging level. Default: INFO. Choices: DEBUG, INFO, WARNING, ERROR, CRITICAL.

    Example usage:

    $ openplayground run --host=0.0.0.0 --port=8080 --debug --env=keys.env --models=models.json --log-level=DEBUG
    """
    logging.basicConfig(level=getattr(logging, log_level.upper()))
    storage = Storage(models, env)
    app.config['GLOBAL_STATE'] = GlobalStateManager(storage)

    app.run(host=host, port=port, debug=debug)


@click.command()
@click.help_option('-h', '--help')
@click.option('--input', '-i', default=None, help='Path to the configuration file for importing models')
def import_config(input):
    """
    Import configuration settings.

    This command imports configuration settings for one or more models from a file.

    Arguments:
    --input, -i: Path to the configuration file for importing models. Default: None.

    Example usage:

    $ openplayground import-config --input=/path/to/config.json
    """
    Storage.import_config(input)


@click.command()
@click.help_option('-h', '--help')
@click.option('--output', '-o', default=None, help='Output file path for the exported configuration settings')
@click.pass_context
def export_config(ctx, output):
    """
    Export configuration settings.

    This command exports the current configuration settings to a file.

    Arguments:
    --output, -o: Output file path for the exported configuration settings. Default: None.

    Example usage:

    $ openplayground export-config --output=/path/to/config.json
    """
    Storage.export_config(output)


cli.add_command(export_config)
cli.add_command(import_config)
cli.add_command(run)

if __name__ == '__main__':
    app.static_folder = '../app/dist'
    run()
else:
    app.static_folder = './static'
