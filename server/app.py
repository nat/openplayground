import click
import logging
import os
import warnings
import io
import queue
import sys
import json
import threading
import time
import re

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
    if path == "" or not os.path.exists(app.static_folder + '/' + path):
        path = 'index.html'

    return send_from_directory(app.static_folder, path)

@app.before_request
def before_request():
    g.global_state = app.config['GLOBAL_STATE']
    g.storage = g.global_state.get_storage()

app.register_blueprint(api_bp)

CORS(app)

class MonitorThread(threading.Thread):
    def __init__(self, model, output_buffer):
        super().__init__()
        self.model = model
        self.output_buffer = output_buffer
        self._stop_event = threading.Event()
        self.event_emitter = EventEmitter()

    def run(self):
        output_buffer = self.output_buffer
        model_name = self.model.name.replace("/", "_")
        current_shard = 0
        total_shards = 0

        while not self._stop_event.is_set():
            last_line = 0
            try:
                lines = output_buffer.getvalue().splitlines()[last_line:]
                for line in lines:
                    if line == "":
                        continue
                    
                    if line.startswith("Downloading shards:"):
                        progress = re.search(r"\| (\d+)/(\d+) \[", line)
                        if progress:
                            current_shard, total_shards = int(progress.group(1)), int(progress.group(2))
                    elif line.startswith("Downloading"):
                        percentage = re.search(r":\s+(\d+)%", line)
                        percentage = percentage.group(0)[2:] if percentage else ""

                        progress = re.search(r"\[(.*?)\]", line)
                        if progress and "?" not in progress.group(0):
                            current_duration, rest = progress.group(0)[1:-1].split("<")
                            total_duration, speed = rest.split(",")

                            download_size = re.search(r"\| (.*?)\[", line)
                            if download_size:
                                current_size, total_size = download_size.group(0)[2:-1].strip().split("/")

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
               with open("error.log", "a") as f:
                   f.write(str(e))
                   f.write("\n")

               print(f"[PROGRESS] {str(e)}")

            last_line += len(lines)
            time.sleep(0.5)

    def stop(self):
        self._stop_event.set()

class NotificationManager:
    def __init__(self, sse_queue: SSEQueueWithTopic):
        self.event_emitter = EventEmitter()
        self.event_emitter.on(EVENTS.MODEL_UPDATED, self.__model_updated_callback__)
        #TODO Fix the bug where SSE gets blocked
        #self.event_emitter.on(EVENTS.MODEL_DOWNLOAD_UPDATE, self.__model_download_update_callback__)
        self.sse_queue = sse_queue

    def __model_updated_callback__(self, model_name, model):
        if model.status == 'ready':
            print("Publishing model added event...")
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
        print(f"Model download progress: {model} {progress}")

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

### Perhaps this should be a singleton or each provider should have its own instance
### For now this will only deal with HuggingFace
class DownloadManager:
    def __init__(self, storage: Storage):
        print("Initializing download manager...")

        self.event_emitter = EventEmitter()
        self.event_emitter.on(EVENTS.MODEL_ADDED, self.__model_added_callback__)
        self.storage = storage
        self.model_queue = queue.Queue()
        self.__initialization_check__()

    def __initialization_check__(self):
        models = self.storage.get_models()

        for model in models:
            if model.status == 'pending':
                self.model_queue.put(model)

        t = threading.Thread(target=self.__download_loop__)
        t.start()

        print("Download loop started...")

    def __model_added_callback__(self, model_name, model):
        if model.status == 'pending':
            self.model_queue.put(model)
     
    def __download_loop__(self):
        while True:
            try:
                output_buffer = io.StringIO()
                model = self.model_queue.get(block=False)

                print(f"Should download {model.name} from {model.provider}")
               
                monitor_thread =  MonitorThread(model, output_buffer)

                monitor_thread.start()
                print("About to start downloading")
                sys.stderr = output_buffer
                sys.stdout = output_buffer
                _ = AutoTokenizer.from_pretrained(model.name)
                _ = AutoModel.from_pretrained(model.name)

                model.status = 'ready'
                sys.stderr = sys.__stderr__
                sys.stdout = sys.__stdout__

                self.storage.update_model(model.name, model)

                monitor_thread.stop()
                monitor_thread.join()
                
                print("Finished downloading model", model.name)
            except queue.Empty:
                time.sleep(1)
            except Exception as e:
                print("error", e)
                print(f"Failed to download {model.name} from {model.provider}")
            finally:
                time.sleep(1)

class GlobalStateManager:
    def __init__(self, storage):
        self.sse_manager = SSEQueueWithTopic()
        self.sse_manager.add_topic("inferences")
        self.sse_manager.add_topic("notifications")

        self.notification_manager = NotificationManager(self.sse_manager.get_topic("notifications"))

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
            api_key=provider.api_key ,
            version_key=None
        )
        logger.info(f"Received inference request {inference_request.model_provider}")

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
@click.option('--host',  '-h', default='localhost', help='The host to bind to [default: localhost]')
@click.option('--port', '-p', default=5432, help='The port to bind to [default: 5432]')
@click.option('--debug/--no-debug', default=False, help='Set flask to debug mode')
@click.option('--env', '-e', default=".env", help='Environment file to read and store API keys')
@click.option('--models', '-m', default=None, help='Config file containing model information')
def run(host, port, debug, env, models):
    storage = Storage(models, env)
    app.config['GLOBAL_STATE'] = GlobalStateManager(storage)

    app.run(host=host, port=port, debug=debug)

cli.add_command(run)

if __name__ == '__main__':
    app.static_folder='../app/dist'
    run()
else:
    app.static_folder='./static'